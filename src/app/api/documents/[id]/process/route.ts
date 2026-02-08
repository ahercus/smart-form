import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getDocument,
  updateDocumentStatus,
} from "@/lib/storage";
import type { DocumentStatus } from "@/lib/types";

/**
 * Document Processing Flow:
 *
 * 1. This route marks document as "extracting"
 * 2. Field extraction happens via /refine-fields (Gemini Vision)
 * 3. Document marked "ready" when extraction completes
 *
 * Speed: Single Gemini Flash call per page (~10s/page)
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

    // Mark as extracting - field extraction will happen via /refine-fields
    await updateDocumentStatus(id, "extracting" as DocumentStatus);

    const totalProcessDuration = Date.now() - processStartTime;
    console.log("[AutoForm] ⏱️ PROCESS ROUTE COMPLETE:", {
      documentId: id,
      totalDurationMs: totalProcessDuration,
    });

    // Check if page images are already uploaded
    // If so, trigger field extraction immediately
    const freshDoc = await getDocument(id);
    const pageImages = freshDoc?.page_images || [];

    if (pageImages.length > 0) {
      console.log("[AutoForm] Page images available, triggering field extraction:", {
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
          console.log("[AutoForm] Field extraction response:", {
            documentId: id,
            status: res.status,
            ok: res.ok,
            data,
          });
        })
        .catch((err) => {
          console.error("[AutoForm] Background extraction failed:", {
            documentId: id,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
    } else {
      console.log("[AutoForm] Waiting for page images:", {
        documentId: id,
        message: "Field extraction will be triggered when images are uploaded",
      });
    }

    return NextResponse.json({
      success: true,
      status: "extracting",
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
