// Admin endpoint to migrate all users' bundle memories to entity system
// POST /api/admin/migrate-memories - Requires admin secret

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEntitiesFromAnswer } from "@/lib/memory/extraction";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

/**
 * POST /api/admin/migrate-memories
 *
 * Admin endpoint to migrate all bundle memories to the entity system.
 * Requires X-Admin-Secret header matching ADMIN_SECRET env var.
 */
export async function POST(request: NextRequest) {
  // Verify admin secret
  const adminSecret = request.headers.get("X-Admin-Secret");
  if (!ADMIN_SECRET || adminSecret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  try {
    // Fetch all bundle memories with user info
    const { data: bundles, error: bundlesError } = await adminClient
      .from("memory_bundles")
      .select("id, name, user_id");

    if (bundlesError) {
      throw new Error(`Failed to fetch bundles: ${bundlesError.message}`);
    }

    if (!bundles || bundles.length === 0) {
      return NextResponse.json({
        status: "no_data",
        message: "No bundle memories to migrate",
      });
    }

    const bundleIds = bundles.map((b) => b.id);
    const bundleMap = new Map(bundles.map((b) => [b.id, { name: b.name, userId: b.user_id }]));

    const { data: memories, error: memoriesError } = await adminClient
      .from("memories")
      .select("id, bundle_id, content")
      .in("bundle_id", bundleIds);

    if (memoriesError) {
      throw new Error(`Failed to fetch memories: ${memoriesError.message}`);
    }

    if (!memories || memories.length === 0) {
      return NextResponse.json({
        status: "no_data",
        message: "No memories found in bundles",
      });
    }

    console.log("[AutoForm] Starting admin memory migration:", {
      bundleCount: bundles.length,
      memoryCount: memories.length,
    });

    // Process each memory through entity extraction
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const userStats: Record<string, { processed: number; skipped: number }> = {};

    for (const memory of memories) {
      const bundle = bundleMap.get(memory.bundle_id);
      if (!bundle) {
        skipped++;
        continue;
      }

      const { name: bundleName, userId } = bundle;
      const content = memory.content?.trim();

      // Initialize user stats
      if (!userStats[userId]) {
        userStats[userId] = { processed: 0, skipped: 0 };
      }

      // Skip empty or very short content
      if (!content || content.length < 3) {
        skipped++;
        userStats[userId].skipped++;
        continue;
      }

      // Skip content that's just a number
      if (/^\d+$/.test(content)) {
        skipped++;
        userStats[userId].skipped++;
        continue;
      }

      // Create a synthetic question based on bundle name
      const syntheticQuestion = getSyntheticQuestion(bundleName, content);

      try {
        await extractEntitiesFromAnswer(userId, syntheticQuestion, content, null);
        processed++;
        userStats[userId].processed++;
      } catch (error) {
        errors.push(`User ${userId}: Failed to process memory: ${error}`);
      }
    }

    // Delete old bundle data after successful migration
    const userIds = [...new Set(bundles.map((b) => b.user_id))];

    // Delete memories first (foreign key constraint)
    await adminClient.from("memories").delete().in("bundle_id", bundleIds);
    // Then delete bundles
    await adminClient.from("memory_bundles").delete().in("user_id", userIds);

    console.log("[AutoForm] Admin memory migration completed:", {
      processed,
      skipped,
      errors: errors.length,
      userStats,
    });

    return NextResponse.json({
      status: "success",
      processed,
      skipped,
      usersProcessed: Object.keys(userStats).length,
      userStats,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[AutoForm] Admin memory migration failed:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}

function getSyntheticQuestion(bundleName: string, content: string): string {
  switch (bundleName.toLowerCase()) {
    case "family":
      return "Tell me about your family members";
    case "personal":
      return "What are your personal details?";
    case "address":
      return "What is your address and contact information?";
    case "emergency contacts":
      return "Who are your emergency contacts?";
    case "medical":
      return "What are your medical details?";
    case "work":
    case "employment":
      return "What is your employment information?";
    case "education":
      return "What is your education background?";
    default:
      return `What is your ${bundleName.toLowerCase()} information?`;
  }
}
