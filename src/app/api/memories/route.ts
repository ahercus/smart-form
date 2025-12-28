import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface MemoryBundle {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_default: boolean;
  memories: Memory[];
}

export interface Memory {
  id: string;
  bundle_id: string;
  content: string;
  source_document_id: string | null;
  source_question: string | null;
  created_at: string;
}

// GET /api/memories - Get all bundles with their memories
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get bundles
    const { data: bundles, error: bundlesError } = await supabase
      .from("memory_bundles")
      .select("id, name, icon, sort_order, is_default")
      .eq("user_id", user.id)
      .order("sort_order");

    if (bundlesError) {
      throw bundlesError;
    }

    // Get memories for all bundles
    const { data: memories, error: memoriesError } = await supabase
      .from("memories")
      .select("id, bundle_id, content, source_document_id, source_question, created_at")
      .in("bundle_id", bundles.map((b) => b.id))
      .order("created_at", { ascending: false });

    if (memoriesError) {
      throw memoriesError;
    }

    // Group memories by bundle
    const bundlesWithMemories: MemoryBundle[] = bundles.map((bundle) => ({
      ...bundle,
      memories: memories.filter((m) => m.bundle_id === bundle.id),
    }));

    return NextResponse.json({ bundles: bundlesWithMemories });
  } catch (error) {
    console.error("[AutoForm] Get memories error:", error);
    return NextResponse.json(
      { error: "Failed to get memories" },
      { status: 500 }
    );
  }
}

// POST /api/memories - Create a new memory
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { bundleId, content, sourceDocumentId, sourceQuestion } = body;

    if (!bundleId || !content) {
      return NextResponse.json(
        { error: "bundleId and content are required" },
        { status: 400 }
      );
    }

    // Verify bundle belongs to user
    const { data: bundle, error: bundleError } = await supabase
      .from("memory_bundles")
      .select("id")
      .eq("id", bundleId)
      .eq("user_id", user.id)
      .single();

    if (bundleError || !bundle) {
      return NextResponse.json(
        { error: "Bundle not found" },
        { status: 404 }
      );
    }

    // Create memory
    const { data: memory, error: memoryError } = await supabase
      .from("memories")
      .insert({
        bundle_id: bundleId,
        content,
        source_document_id: sourceDocumentId || null,
        source_question: sourceQuestion || null,
      })
      .select()
      .single();

    if (memoryError) {
      throw memoryError;
    }

    console.log("[AutoForm] Memory created:", {
      id: memory.id,
      bundleId,
      contentPreview: content.slice(0, 50),
    });

    return NextResponse.json({ memory });
  } catch (error) {
    console.error("[AutoForm] Create memory error:", error);
    return NextResponse.json(
      { error: "Failed to create memory" },
      { status: 500 }
    );
  }
}
