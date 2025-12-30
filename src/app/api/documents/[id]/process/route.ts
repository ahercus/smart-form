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
import { shouldRunQC, calculateAverageConfidence } from "@/lib/form-analysis";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentStatus, ExtractedField } from "@/lib/types";

/**
 * OPTIMISTIC RENDERING STRATEGY
 *
 * We show fields immediately after Azure extraction because:
 * 1. Azure is 85-90% accurate - good enough for user to start
 * 2. QC takes 5-10s - too long to block the entire UX
 * 3. If QC finds issues, we'll update fields in place (rare)
 *
 * User experience:
 * - T+5s: Fields appear, user can type
 * - T+15s: QC completes, maybe adjusts 1-2 fields
 *
 * This is better than:
 * - T+15s: Everything appears at once (user waited 10 extra seconds)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log("[AutoForm] Process route called");

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
    const fileData = await getFile(document.storage_path);

    // Process the document with Azure Document Intelligence
    const result = await processDocument(
      id,
      fileData,
      async (status: string) => {
        await updateDocumentStatus(id, status as DocumentStatus);
      }
    );

    if (!result.success) {
      await updateDocumentStatus(id, "failed", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Store extracted fields
    await setDocumentFields(id, result.fields);
    await updateDocument(id, { page_count: result.pageCount });

    // MARK AS READY NOW (don't wait for QC) - OPTIMISTIC RENDERING
    await updateDocumentStatus(id, "ready");

    // Calculate confidence for QC decision
    const confidence = calculateAverageConfidence(result.fields as ExtractedField[]);
    const qcDecision = shouldRunQC(result.fields as ExtractedField[]);

    console.log("[AutoForm] QC decision:", {
      documentId: id,
      avgConfidence: (confidence.average * 100).toFixed(0) + "%",
      fieldCount: result.fields.length,
      shouldRunQC: qcDecision.shouldRun,
      reason: qcDecision.reason,
    });

    const adminClient = createAdminClient();

    if (qcDecision.shouldRun) {
      // Low confidence or complex - run QC in background (true fire-and-forget)
      const baseUrl = request.nextUrl.origin;
      fetch(`${baseUrl}/api/documents/${id}/refine-fields`, {
        method: "POST",
        headers: {
          Cookie: request.headers.get("cookie") || "",
        },
      }).catch((err) => {
        console.error("[AutoForm] Background refinement failed:", {
          documentId: id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
    } else {
      // High confidence - skip QC, mark complete immediately
      await adminClient
        .from("documents")
        .update({
          fields_qc_complete: true,
          qc_skipped: true,
          qc_skip_reason: qcDecision.reason,
        })
        .eq("id", id);

      console.log("[AutoForm] Skipping QC - high confidence:", {
        documentId: id,
        reason: qcDecision.reason,
      });
    }

    return NextResponse.json({
      success: true,
      status: "ready", // READY NOW - user can see fields immediately
      field_count: result.fields.length,
      page_count: result.pageCount,
      qc_skipped: !qcDecision.shouldRun,
      avg_confidence: (confidence.average * 100).toFixed(0) + "%",
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
