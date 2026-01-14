import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getDocument,
  getFile,
  updateDocumentStatus,
  updateDocument,
  setDocumentFields,
} from "@/lib/storage";
import { processDocument } from "@/lib/processing";
import { preGenerateQuestions } from "@/lib/orchestrator/question-pregeneration";
import type { DocumentStatus, ExtractedField } from "@/lib/types";

/**
 * Document Processing Flow:
 *
 * 1. Azure Document Intelligence extracts fields (~5s)
 * 2. Gemini Vision QC refines field coordinates (~5-10s)
 * 3. Document marked "ready" - fields shown to user
 *
 * Why QC is always required:
 * - Azure's confidence scores don't reflect coordinate accuracy
 * - Field boxes are often misaligned without QC
 * - QC catches missing fields and table fragmentation
 *
 * Speed optimizations applied:
 * - Question generation uses Flash (no vision) - 1-2s vs 3-5s
 * - Pages processed in parallel - 5x speedup for multi-page forms
 * - Form type inferred from field labels (no vision call)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const processStartTime = Date.now();
  console.log("[AutoForm] ⏱️ PROCESS ROUTE START");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.log("[AutoForm] Process route: Unauthorized - no user");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  console.log("[AutoForm] Process route: Processing document", { documentId: id });

  try {
    const document = await getDocument(id);
    if (!document) {
      console.log("[AutoForm] Process route: Document not found", { documentId: id });
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Verify ownership
    if (document.user_id !== user.id) {
      console.log("[AutoForm] Process route: Not authorized for this document");
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    console.log("[AutoForm] Process route: Document status check", {
      documentId: id,
      status: document.status,
    });

    // Don't reprocess if already processing or ready
    if (document.status !== "uploading") {
      console.log("[AutoForm] Process route: Skipping - already processed", {
        documentId: id,
        status: document.status,
      });
      return NextResponse.json({
        message: "Document already processed or processing",
        status: document.status,
      });
    }

    // Get file data from storage
    const fileLoadStart = Date.now();
    const fileData = await getFile(document.storage_path);
    const fileLoadDuration = Date.now() - fileLoadStart;
    console.log(`[AutoForm] ⏱️ File loaded from storage (${fileLoadDuration}ms)`);

    // Process the document with Azure Document Intelligence
    const azureStart = Date.now();
    const result = await processDocument(
      id,
      fileData,
      async (status: string) => {
        await updateDocumentStatus(id, status as DocumentStatus);
      }
    );
    const azureDuration = Date.now() - azureStart;
    console.log(`[AutoForm] ⏱️ Azure DI processing complete (${(azureDuration / 1000).toFixed(1)}s)`);

    if (!result.success) {
      await updateDocumentStatus(id, "failed", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Store extracted fields
    const dbSaveStart = Date.now();
    await setDocumentFields(id, result.fields);
    await updateDocument(id, { page_count: result.pageCount });
    const dbSaveDuration = Date.now() - dbSaveStart;
    console.log(`[AutoForm] ⏱️ Fields saved to database (${dbSaveDuration}ms)`);

    // DON'T mark as ready yet - wait for QC to complete
    // Azure's confidence scores don't reflect coordinate accuracy
    // QC is essential for proper field positioning

    // PRE-WARM OPTIMIZATION: Start question pre-generation immediately
    // Questions are saved with status="pending_context" (hidden until context submitted)
    // This runs in parallel with QC - when both complete + context submitted, questions appear instantly
    if (result.fields.length > 0) {
      preGenerateQuestions({
        documentId: id,
        fields: result.fields as ExtractedField[],
      })
        .then((pregenResult) => {
          console.log("[AutoForm] Question pre-generation complete:", {
            documentId: id,
            questionsPregenerated: pregenResult.questionsPregenerated,
            success: pregenResult.success,
          });
        })
        .catch((err) => {
          // Non-fatal: questions will be generated normally on context submit
          console.error("[AutoForm] Question pre-generation failed (non-fatal):", {
            documentId: id,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
    }

    const totalProcessDuration = Date.now() - processStartTime;
    console.log("[AutoForm] ⏱️ PROCESS ROUTE COMPLETE:", {
      documentId: id,
      fieldCount: result.fields.length,
      totalDurationMs: totalProcessDuration,
      breakdown: {
        fileLoad: `${fileLoadDuration}ms`,
        azureDI: `${(azureDuration / 1000).toFixed(1)}s`,
        dbSave: `${dbSaveDuration}ms`,
      },
    });

    // Check if page images are already uploaded (client may have uploaded them while Azure was processing)
    // If so, trigger QC immediately. If not, pages/route.ts will trigger QC when images arrive.
    const freshDoc = await getDocument(id);
    const pageImages = freshDoc?.page_images || [];

    if (pageImages.length > 0) {
      console.log("[AutoForm] Page images already available, triggering QC:", {
        documentId: id,
        pageCount: pageImages.length,
      });

      const baseUrl = request.nextUrl.origin;
      fetch(`${baseUrl}/api/documents/${id}/refine-fields`, {
        method: "POST",
        headers: {
          Cookie: request.headers.get("cookie") || "",
        },
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          console.log("[AutoForm] Field refinement response:", {
            documentId: id,
            status: res.status,
            ok: res.ok,
            data,
          });
        })
        .catch((err) => {
          console.error("[AutoForm] Background refinement failed:", {
            documentId: id,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
    } else {
      console.log("[AutoForm] Waiting for page images before QC:", {
        documentId: id,
        message: "QC will be triggered by pages route when images are uploaded",
      });
    }

    return NextResponse.json({
      success: true,
      status: "extracting", // Not ready yet - QC pending
      field_count: result.fields.length,
      page_count: result.pageCount,
    });
  } catch (error) {
    console.error(`[AutoForm] Process route error:`, error);
    await updateDocumentStatus(
      id,
      "failed",
      error instanceof Error ? error.message : "Processing failed"
    );
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
