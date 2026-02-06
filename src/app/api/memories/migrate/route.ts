// One-time migration endpoint to convert old bundle memories to entity system
// POST /api/memories/migrate - Migrate current user's bundle memories to entities

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEntitiesFromAnswer } from "@/lib/memory/extraction";

interface BundleMemory {
  id: string;
  bundle_name: string;
  content: string;
}

/**
 * POST /api/memories/migrate
 *
 * Migrates all bundle memories for the current user to the entity system.
 * Each memory is processed through the entity extraction pipeline.
 * After successful migration, old bundle data is deleted.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  try {
    // Fetch all bundle memories for the user
    const { data: bundles, error: bundlesError } = await adminClient
      .from("memory_bundles")
      .select("id, name")
      .eq("user_id", user.id);

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
    const bundleNameMap = new Map(bundles.map((b) => [b.id, b.name]));

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

    console.log("[AutoForm] Starting memory migration:", {
      userId: user.id,
      bundleCount: bundles.length,
      memoryCount: memories.length,
    });

    // Process each memory through entity extraction
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const memory of memories) {
      const bundleName = bundleNameMap.get(memory.bundle_id) || "Unknown";
      const content = memory.content?.trim();

      // Skip empty or very short content
      if (!content || content.length < 3) {
        skipped++;
        continue;
      }

      // Skip content that looks like just a number or single word without context
      if (/^\d+$/.test(content) || content.split(/\s+/).length === 1) {
        // Single words might be names - process them with context
        if (bundleName === "Family" || bundleName === "Personal") {
          // Add context for better extraction
          const contextualQuestion = `What do you know about ${content}?`;
          try {
            await extractEntitiesFromAnswer(
              user.id,
              contextualQuestion,
              `${content} is a ${bundleName.toLowerCase()} member/detail`,
              null
            );
            processed++;
          } catch (error) {
            errors.push(`Failed to process "${content}": ${error}`);
          }
        } else {
          skipped++;
        }
        continue;
      }

      // Create a synthetic question based on bundle name
      const syntheticQuestion = getSyntheticQuestion(bundleName, content);

      try {
        await extractEntitiesFromAnswer(user.id, syntheticQuestion, content, null);
        processed++;
      } catch (error) {
        errors.push(`Failed to process memory: ${error}`);
      }
    }

    // Delete old bundle data after successful migration
    if (processed > 0) {
      // Delete memories first (foreign key constraint)
      await adminClient.from("memories").delete().in("bundle_id", bundleIds);
      // Then delete bundles
      await adminClient.from("memory_bundles").delete().eq("user_id", user.id);

      console.log("[AutoForm] Deleted old bundle data:", {
        userId: user.id,
        bundlesDeleted: bundles.length,
      });
    }

    console.log("[AutoForm] Memory migration completed:", {
      userId: user.id,
      processed,
      skipped,
      errors: errors.length,
    });

    return NextResponse.json({
      status: "success",
      processed,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[AutoForm] Memory migration failed:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Generate a synthetic question based on bundle name to give context to extraction
 */
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
