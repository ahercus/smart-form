import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateQuestions } from "@/lib/orchestrator/question-generator";
import { getPageImageBase64 } from "@/lib/storage";

// Allow up to 5 minutes for question generation (Vercel Pro limit)
export const maxDuration = 300;

// POST /api/documents/[id]/context - Submit context and trigger question generation
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
    const { context, skip } = body;

    const adminClient = createAdminClient();

    // Save context to document
    await adminClient
      .from("documents")
      .update({
        context_notes: context || null,
        context_submitted: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Context submitted:", {
      documentId,
      hasContext: !!context,
      skipped: !!skip,
    });

    // Wait for field QC to complete before generating questions
    // This prevents duplicate QC runs
    const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes max
    const POLL_INTERVAL_MS = 1000; // Check every second
    const startTime = Date.now();

    let fieldsQCComplete = document.fields_qc_complete;
    while (!fieldsQCComplete && Date.now() - startTime < MAX_WAIT_MS) {
      console.log("[AutoForm] Waiting for field QC to complete...", {
        documentId,
        elapsedMs: Date.now() - startTime,
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const { data: updated } = await adminClient
        .from("documents")
        .select("fields_qc_complete")
        .eq("id", documentId)
        .single();

      fieldsQCComplete = updated?.fields_qc_complete || false;
    }

    if (!fieldsQCComplete) {
      console.warn("[AutoForm] Field QC did not complete in time, proceeding anyway:", {
        documentId,
        elapsedMs: Date.now() - startTime,
      });
    } else {
      console.log("[AutoForm] Field QC complete, starting question generation:", {
        documentId,
        waitedMs: Date.now() - startTime,
      });
    }

    // Get page images for question generation
    const pageImages = document.page_images || [];

    if (pageImages.length > 0) {
      // Prepare page images for question generator
      const pageImagesWithBase64 = await Promise.all(
        pageImages.map(async (p: { page: number; storage_path: string }) => ({
          pageNumber: p.page,
          imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
        }))
      );

      // Filter out pages without images
      const validPageImages = pageImagesWithBase64.filter((p) => p.imageBase64);

      if (validPageImages.length > 0) {
        console.log("[AutoForm] Starting question generation:", {
          documentId,
          pageCount: validPageImages.length,
        });

        // IMPORTANT: Must await to prevent Vercel serverless from killing the process
        // before question generation completes
        const result = await generateQuestions({
          documentId,
          userId: user.id,
          pageImages: validPageImages,
        });

        console.log("[AutoForm] Question generation complete:", {
          documentId,
          success: result.success,
          questionsGenerated: result.questionsGenerated,
        });

        return NextResponse.json({
          success: true,
          message: skip ? "Skipped context, questions generated" : "Context saved, questions generated",
          questionsGenerated: result.questionsGenerated,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: skip ? "Skipped context, no pages to process" : "Context saved, no pages to process",
    });
  } catch (error) {
    console.error("[AutoForm] Context submission error:", error);
    return NextResponse.json(
      { error: "Failed to submit context" },
      { status: 500 }
    );
  }
}
