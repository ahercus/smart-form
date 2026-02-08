import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getPageImageBase64 } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuestions } from "@/lib/orchestrator/question-generator";

// Allow up to 5 minutes for question generation (Vercel Pro limit)
export const maxDuration = 300;

/**
 * POST /api/documents/[id]/context - Submit context and trigger question generation
 *
 * Flow:
 * 1. Save context to document
 * 2. If field extraction is complete, generate questions with full document context
 * 3. If still extracting, questions will be generated when extraction completes
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
    const {
      context,
      skip,
      useMemory,
      clientDateTime,
      clientTimeZone,
      clientTimeZoneOffsetMinutes,
    } = body;

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
      fieldsComplete: document.fields_qc_complete,
    });

    // Check if questions were already generated (race condition)
    const freshDoc = await getDocument(documentId);
    if (freshDoc?.questions_generated_at) {
      const totalDuration = Date.now() - contextStartTime;
      console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - ALREADY GENERATED (${(totalDuration / 1000).toFixed(1)}s)`);

      return NextResponse.json({
        success: true,
        message: "Context saved, questions already generated",
      });
    }

    // Generate questions if field extraction is complete
    const pageImages = freshDoc?.page_images || [];

    if (pageImages.length > 0 && freshDoc?.fields_qc_complete) {
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
          clientDateTime,
          clientTimeZone,
          clientTimeZoneOffsetMinutes,
        });

        const totalDuration = Date.now() - contextStartTime;
        console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - QUESTIONS GENERATED (${(totalDuration / 1000).toFixed(1)}s):`, {
          documentId,
          questionsGenerated: result.questionsGenerated,
          entitiesDetected: result.entitiesDetected,
        });

        return NextResponse.json({
          success: true,
          message: skip ? "Skipped context, questions generated" : "Context saved, questions generated",
          questionsGenerated: result.questionsGenerated,
          entitiesDetected: result.entitiesDetected,
        });
      }
    }

    // Field extraction not complete - questions will be generated when it finishes
    console.log("[AutoForm] Context saved, waiting for field extraction:", {
      documentId,
      fieldsComplete: freshDoc?.fields_qc_complete,
    });

    const totalDuration = Date.now() - contextStartTime;
    console.log(`[AutoForm] ⏱️ CONTEXT ROUTE COMPLETE - WAITING (${(totalDuration / 1000).toFixed(1)}s)`);

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
