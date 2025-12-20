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
import type { DocumentStatus } from "@/lib/types";

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
      status: document.status
    });

    // Don't reprocess if already processing or ready
    if (document.status !== "uploading") {
      console.log("[AutoForm] Process route: Skipping - already processed", {
        documentId: id,
        status: document.status
      });
      return NextResponse.json({
        message: "Document already processed or processing",
        status: document.status,
      });
    }

    // Get file data from storage
    const fileData = await getFile(document.storage_path);

    // Process the document (using mock for now, will integrate real AI later)
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

    return NextResponse.json({
      success: true,
      status: "ready",
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
