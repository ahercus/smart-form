import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuestions } from "@/lib/orchestrator/question-generator";
import { getPageImageBase64 } from "@/lib/storage";

// Allow up to 5 minutes for question generation (Vercel Pro limit)
export const maxDuration = 300;

/**
 * POST /api/documents/[id]/context - Submit context and trigger question generation
 *
 * OPTIMISTIC QUESTION GENERATION:
 * Questions are generated from Azure fields IMMEDIATELY (no QC wait).
 * If QC completes later and changes fields, reconciliation handles it.
 *
 * Timeline:
 * - T+0s: User submits context
 * - T+1-3s: Questions generated from Azure fields (parallel, no vision)
 * - T+10s: QC may complete in background, may add 1-2 questions
 *
 * This is 5-10s faster than waiting for QC to complete.
 */
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

    const body = await request.json();
    const { context, skip, useMemory } = body;

    const adminClient = createAdminClient();

    // Save context and memory preference to document
    await adminClient
      .from("documents")
      .update({
        context_notes: context || null,
        context_submitted: true,
        use_memory: useMemory !== undefined ? useMemory : true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Context submitted (OPTIMISTIC - no QC wait):", {
      documentId,
      hasContext: !!context,
      skipped: !!skip,
      useMemory: useMemory !== undefined ? useMemory : true,
      qcComplete: document.fields_qc_complete,
    });

    // NO LONGER WAITING FOR QC - generate questions from Azure fields immediately
    // This is the key optimization: 5-10s faster

    // Get page images for question generation
    const pageImages = document.page_images || [];

    if (pageImages.length > 0) {
      // Prepare page images for question generator
      // Note: pageImageBase64 is still passed for backward compatibility
      // but generateQuestionsForPage no longer uses it (Flash, no vision)
      const pageImagesWithBase64 = await Promise.all(
        pageImages.map(async (p: { page: number; storage_path: string }) => ({
          pageNumber: p.page,
          imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
        }))
      );

      // Filter out pages without images
      const validPageImages = pageImagesWithBase64.filter((p) => p.imageBase64);

      if (validPageImages.length > 0) {
        console.log("[AutoForm] Starting question generation (OPTIMISTIC):", {
          documentId,
          pageCount: validPageImages.length,
          strategy: document.fields_qc_complete
            ? "post-QC"
            : "optimistic (Azure fields)",
        });

        // Generate questions from current fields (Azure or QC'd if already complete)
        const result = await generateQuestions({
          documentId,
          userId: user.id,
          pageImages: validPageImages,
          useMemory: useMemory !== undefined ? useMemory : true,
        });

        console.log("[AutoForm] Question generation complete:", {
          documentId,
          success: result.success,
          questionsGenerated: result.questionsGenerated,
        });

        return NextResponse.json({
          success: true,
          message: skip
            ? "Skipped context, questions generated"
            : "Context saved, questions generated",
          questionsGenerated: result.questionsGenerated,
          optimistic: !document.fields_qc_complete,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: skip
        ? "Skipped context, no pages to process"
        : "Context saved, no pages to process",
    });
  } catch (error) {
    console.error("[AutoForm] Context submission error:", error);
    return NextResponse.json(
      { error: "Failed to submit context" },
      { status: 500 }
    );
  }
}
