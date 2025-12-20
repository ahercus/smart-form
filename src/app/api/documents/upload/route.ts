import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDocument } from "@/lib/storage";

export async function POST(request: NextRequest) {
  // Get authenticated user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const contextNotes = formData.get("contextNotes") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 400 }
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be under 10MB" },
        { status: 400 }
      );
    }

    const fileData = await file.arrayBuffer();
    const document = await createDocument(
      user.id,
      file.name,
      fileData,
      contextNotes || undefined
    );

    console.log(`[AutoForm] Document uploaded:`, {
      id: document.id,
      filename: document.original_filename,
      size: document.file_size_bytes,
    });

    // Trigger processing asynchronously
    const baseUrl = request.nextUrl.origin;
    console.log("[AutoForm] Triggering document processing:", {
      documentId: document.id,
      baseUrl,
      processUrl: `${baseUrl}/api/documents/${document.id}/process`,
    });

    fetch(`${baseUrl}/api/documents/${document.id}/process`, {
      method: "POST",
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        console.log("[AutoForm] Process trigger response:", {
          documentId: document.id,
          status: res.status,
          ok: res.ok,
          data,
        });
      })
      .catch((err) => {
        console.error(`[AutoForm] Failed to trigger processing:`, {
          documentId: document.id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });

    return NextResponse.json({
      document_id: document.id,
      status: document.status,
      message: "Document received. Processing will begin shortly.",
    });
  } catch (error) {
    console.error(`[AutoForm] Upload failed:`, error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
