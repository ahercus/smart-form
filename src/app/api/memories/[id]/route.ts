import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/memories/[id] - Update a memory
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
    const body = await request.json();
    const { content, bundleId } = body;

    // Verify memory belongs to user (via bundle)
    const { data: existing, error: existingError } = await supabase
      .from("memories")
      .select("id, bundle_id, memory_bundles!inner(user_id)")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundleUserId = (existing.memory_bundles as any)?.user_id;
    if (bundleUserId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Build update object
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (content !== undefined) updates.content = content;
    if (bundleId !== undefined) {
      // Verify new bundle belongs to user
      const { data: newBundle, error: bundleError } = await supabase
        .from("memory_bundles")
        .select("id")
        .eq("id", bundleId)
        .eq("user_id", user.id)
        .single();

      if (bundleError || !newBundle) {
        return NextResponse.json(
          { error: "Target bundle not found" },
          { status: 404 }
        );
      }
      updates.bundle_id = bundleId;
    }

    // Update memory
    const { data: memory, error: updateError } = await supabase
      .from("memories")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log("[AutoForm] Memory updated:", { id });

    return NextResponse.json({ memory });
  } catch (error) {
    console.error("[AutoForm] Update memory error:", error);
    return NextResponse.json(
      { error: "Failed to update memory" },
      { status: 500 }
    );
  }
}

// DELETE /api/memories/[id] - Delete a memory
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
    // Verify memory belongs to user (via bundle)
    const { data: existing, error: existingError } = await supabase
      .from("memories")
      .select("id, bundle_id, memory_bundles!inner(user_id)")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundleUserId = (existing.memory_bundles as any)?.user_id;
    if (bundleUserId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Delete memory
    const { error: deleteError } = await supabase
      .from("memories")
      .delete()
      .eq("id", id);

    if (deleteError) {
      throw deleteError;
    }

    console.log("[AutoForm] Memory deleted:", { id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AutoForm] Delete memory error:", error);
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
