import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

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

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Create signed URL for the PDF
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.storage
      .from("documents")
      .createSignedUrl(document.storage_path, 3600); // 1 hour expiry

    if (error || !data?.signedUrl) {
      console.error("[AutoForm] Failed to create signed URL:", error);
      return NextResponse.json(
        { error: "Failed to get PDF URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: data.signedUrl,
      filename: document.original_filename,
    });
  } catch (error) {
    console.error(`[AutoForm] Get PDF URL error:`, error);
    return NextResponse.json(
      { error: "Failed to get PDF" },
      { status: 500 }
    );
  }
}
