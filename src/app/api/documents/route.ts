import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocumentsByUser } from "@/lib/storage";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const documents = await getDocumentsByUser(user.id);
    return NextResponse.json({ documents });
  } catch (error) {
    console.error(`[AutoForm] List documents error:`, error);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 }
    );
  }
}
