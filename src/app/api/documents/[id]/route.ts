import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getDocument,
  getDocumentFields,
  deleteDocument,
} from "@/lib/storage";

export async function GET(
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

  const { id } = await params;

  try {
    const document = await getDocument(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Verify ownership
    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get fields if document is ready
    const fields =
      document.status === "ready" ? await getDocumentFields(id) : [];

    // Strip ocr_text to avoid exceeding Vercel's 4.5MB response limit
    const { ocr_text: _, ...doc } = document;

    return NextResponse.json({
      ...doc,
      fields,
    });
  } catch (error) {
    console.error(`[AutoForm] Get document error:`, error);
    return NextResponse.json(
      { error: "Failed to get document" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

  const { id } = await params;

  try {
    const document = await getDocument(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await deleteDocument(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[AutoForm] Delete document error:`, error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

  const { id } = await params;

  try {
    const document = await getDocument(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { use_memory, original_filename } = body;

    const updates: Record<string, unknown> = {};

    if (typeof use_memory === "boolean") {
      updates.use_memory = use_memory;
    }

    if (typeof original_filename === "string") {
      const trimmed = original_filename.trim();
      if (trimmed.length === 0 || trimmed.length > 255) {
        return NextResponse.json(
          { error: "Filename must be between 1 and 255 characters" },
          { status: 400 }
        );
      }
      updates.original_filename = trimmed;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      throw updateError;
    }

    console.log(`[AutoForm] Document updated:`, { id, ...updates });

    return NextResponse.json({ success: true, ...updates });
  } catch (error) {
    console.error(`[AutoForm] Update document error:`, error);
    return NextResponse.json(
      { error: "Failed to update document" },
      { status: 500 }
    );
  }
}
