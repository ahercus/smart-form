import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndFinalizeIfReady } from "@/lib/orchestrator/question-finalization";
import { generateQuestions } from "@/lib/orchestrator/question-generator";
import { getPageImageBase64 } from "@/lib/storage";

// Allow up to 5 minutes for question generation (Vercel Pro limit)
export const maxDuration = 300;

/**
 * POST /api/documents/[id]/context - Submit context and trigger question generation
 *
 * When context is submitted:
 * - If extraction complete → generate questions with context
 * - If still extracting → questions generated when extraction completes
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contextStartTime = Date.now();
  console.log("[AutoForm] ⏱️ CONTEXT ROUTE START");

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

    console.log("[AutoForm] Context submitted:", {
      documentId,
      hasContext: !!context,
      skipped: !!skip,
      useMemory: useMemory !== undefined ? useMemory : true,
      qcComplete: document.fields_qc_complete,
      pregenerated: document.questions_pregenerated,
    });

    // PRE-WARM PATH: Try to finalize pre-generated questions
    // This is the fast path - questions appear instantly if pre-gen + QC are ready
    const finalized = await checkAndFinalizeIfReady(documentId, user.id);

    if (finalized) {
      const totalDuration = Date.now() - contextStartTime;
      console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - INSTANT FINALIZATION (${(totalDuration / 1000).toFixed(1)}s):`, {
        documentId,
        durationMs: totalDuration,
      });

      return NextResponse.json({
        success: true,
        message: skip
          ? "Skipped context, questions finalized"
          : "Context saved, questions finalized",
        finalized: true,
        instant: true,
      });
    }

    // Check fresh document state
    const freshDoc = await getDocument(documentId);

    // If questions were already generated (race condition), we're done
    if (freshDoc?.questions_generated_at) {
      const totalDuration = Date.now() - contextStartTime;
      console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - ALREADY GENERATED (${(totalDuration / 1000).toFixed(1)}s):`, {
        documentId,
      });

      return NextResponse.json({
        success: true,
        message: "Context saved, questions already generated",
        finalized: true,
      });
    }

    // FALLBACK PATH: Pre-generation didn't run or failed
    // Generate questions directly if needed
    if (!freshDoc?.questions_pregenerated) {
      console.log("[AutoForm] Pre-generation not complete, falling back to direct generation:", {
        documentId,
        qcComplete: freshDoc?.fields_qc_complete,
        pregenerated: freshDoc?.questions_pregenerated,
      });

      // Get page images for question generation
      const pageImages = freshDoc?.page_images || [];

      if (pageImages.length > 0) {
        const pageImagesWithBase64 = await Promise.all(
          pageImages.map(async (p: { page: number; storage_path: string }) => ({
            pageNumber: p.page,
            imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
          }))
        );

        const validPageImages = pageImagesWithBase64.filter((p) => p.imageBase64);

        if (validPageImages.length > 0) {
          const result = await generateQuestions({
            documentId,
            userId: user.id,
            pageImages: validPageImages,
            useMemory: useMemory !== undefined ? useMemory : true,
          });

          const totalDuration = Date.now() - contextStartTime;
          console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - FALLBACK GENERATION (${(totalDuration / 1000).toFixed(1)}s):`, {
            documentId,
            questionsGenerated: result.questionsGenerated,
          });

          return NextResponse.json({
            success: true,
            message: skip
              ? "Skipped context, questions generated"
              : "Context saved, questions generated",
            questionsGenerated: result.questionsGenerated,
            fallback: true,
          });
        }
      }
    }

    // WAITING PATH: Pre-gen exists but QC not complete
    // Finalization will be triggered by QC completion (field-refinement.ts)
    console.log("[AutoForm] Context saved, waiting for QC to complete:", {
      documentId,
      qcComplete: freshDoc?.fields_qc_complete,
      pregenerated: freshDoc?.questions_pregenerated,
    });

    const totalDuration = Date.now() - contextStartTime;
    console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - WAITING (${(totalDuration / 1000).toFixed(1)}s):`, {
      documentId,
    });

    return NextResponse.json({
      success: true,
      message: skip
        ? "Skipped context, waiting for processing to complete"
        : "Context saved, waiting for processing to complete",
      waiting: true,
    });
  } catch (error) {
    console.error("[AutoForm] Context submission error:", error);
    return NextResponse.json(
      { error: "Failed to submit context" },
      { status: 500 }
    );
  }
}
