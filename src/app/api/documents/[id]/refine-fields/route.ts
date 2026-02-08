import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getPageImageBase64, setPageFields, updateDocument } from "@/lib/storage";
import { refineFields } from "@/lib/orchestrator/field-refinement";
import { extractAllPagesWithQuadrants } from "@/lib/orchestrator/quadrant-extraction";
import { checkAndFinalizeIfReady } from "@/lib/orchestrator/question-finalization";
import { generateQuestions } from "@/lib/orchestrator/question-generator";

// Feature flag for new quadrant-based extraction
const USE_QUADRANT_EXTRACTION = process.env.USE_QUADRANT_EXTRACTION === "true";

// POST /api/documents/[id]/refine-fields - Run Gemini QC on extracted fields
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  try {
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Check if already refined
    if (document.fields_qc_complete) {
      console.log("[AutoForm] Fields already QC'd, skipping:", { documentId });
      return NextResponse.json({
        success: true,
        message: "Fields already refined",
        cached: true,
      });
    }

    // Get page images
    const pageImages = document.page_images || [];
    if (pageImages.length === 0) {
      console.log("[AutoForm] No page images available for refinement:", { documentId });
      return NextResponse.json({
        success: false,
        error: "No page images available",
      }, { status: 400 });
    }

    // Load page images as base64
    const pageImagesWithData = await Promise.all(
      pageImages.map(async (p: { page: number; storage_path: string }) => ({
        pageNumber: p.page,
        imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
      }))
    );

    // Filter out pages without images
    const validPageImages = pageImagesWithData.filter((p) => p.imageBase64);

    if (validPageImages.length === 0) {
      console.log("[AutoForm] No valid page images for refinement:", { documentId });
      return NextResponse.json({
        success: false,
        error: "Failed to load page images",
      }, { status: 500 });
    }

    // Branch based on extraction mode
    if (USE_QUADRANT_EXTRACTION) {
      // NEW: Quadrant-based extraction (replaces Azure + cluster QC)
      // Processes ALL pages in parallel with progressive field reveal
      console.log("[AutoForm] Starting QUADRANT extraction (feature flag enabled):", {
        documentId,
        pageCount: validPageImages.length,
      });

      let pagesCompleted = 0;

      const extractionResult = await extractAllPagesWithQuadrants({
        documentId,
        pageImages: validPageImages,
        // Progressive reveal: save fields as each page completes
        onPageComplete: async (pageResult) => {
          pagesCompleted++;
          console.log("[AutoForm] Page extraction complete, saving fields:", {
            documentId,
            pageNumber: pageResult.pageNumber,
            fieldsFound: pageResult.fields.length,
            pagesCompleted,
            totalPages: validPageImages.length,
          });

          // Save this page's fields to database immediately (page-scoped to avoid race conditions)
          await setPageFields(documentId, pageResult.pageNumber, pageResult.fields);
        },
      });

      // Mark QC complete and document ready (all pages done)
      await updateDocument(documentId, {
        fields_qc_complete: true,
        status: "ready",
      });

      console.log("[AutoForm] Quadrant extraction complete:", {
        documentId,
        totalFields: extractionResult.allFields.length,
        totalDurationMs: extractionResult.totalDurationMs,
      });

      // Trigger question generation if context already submitted
      // (In quadrant mode, there's no pre-generation, so we generate directly)
      const freshDoc = await getDocument(documentId);
      let questionsGenerated = 0;

      if (freshDoc?.context_submitted) {
        console.log("[AutoForm] Context already submitted, generating questions:", { documentId });

        try {
          const result = await generateQuestions({
            documentId,
            userId: user.id,
            pageImages: validPageImages,
            useMemory: freshDoc.use_memory ?? true,
          });
          questionsGenerated = result.questionsGenerated;

          console.log("[AutoForm] Questions generated after quadrant extraction:", {
            documentId,
            questionsGenerated,
          });
        } catch (err) {
          console.error("[AutoForm] Question generation failed:", err);
        }
      } else {
        console.log("[AutoForm] Context not yet submitted, questions will generate on context submit:", { documentId });
      }

      return NextResponse.json({
        success: true,
        mode: "quadrant_extraction",
        fieldsExtracted: extractionResult.allFields.length,
        questionsGenerated,
        pageResults: extractionResult.pageResults.map((p) => ({
          pageNumber: p.pageNumber,
          fieldsFound: p.fields.length,
          durationMs: p.totalDurationMs,
          context: p.context,
        })),
      });
    }

    // EXISTING: Cluster-based refinement (Azure fields + Gemini QC)
    console.log("[AutoForm] Starting field refinement (cluster QC):", {
      documentId,
      pageCount: validPageImages.length,
    });

    // Run field refinement
    const result = await refineFields({
      documentId,
      userId: user.id,
      pageImages: validPageImages,
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      mode: "cluster_qc",
      fieldsAdjusted: result.fieldsAdjusted,
      fieldsAdded: result.fieldsAdded,
      fieldsRemoved: result.fieldsRemoved,
    });
  } catch (error) {
    console.error("[AutoForm] Refine fields error:", error);
    return NextResponse.json(
      { error: "Failed to refine fields" },
      { status: 500 }
    );
  }
}
