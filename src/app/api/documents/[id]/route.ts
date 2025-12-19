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

    return NextResponse.json({
      ...document,
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
