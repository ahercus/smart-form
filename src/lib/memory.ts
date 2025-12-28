// Memory utilities for AI context

import { createAdminClient } from "./supabase/admin";

export interface MemoryBundle {
  id: string;
  name: string;
  icon: string;
  memories: Array<{
    id: string;
    content: string;
  }>;
}

/**
 * Fetch all memories for a user, organized by bundle
 */
export async function getUserMemories(userId: string): Promise<MemoryBundle[]> {
  const supabase = createAdminClient();

  // Get bundles
  const { data: bundles, error: bundlesError } = await supabase
    .from("memory_bundles")
    .select("id, name, icon, sort_order")
    .eq("user_id", userId)
    .order("sort_order");

  if (bundlesError || !bundles) {
    console.error("[AutoForm] Failed to fetch memory bundles:", bundlesError);
    return [];
  }

  // Get memories for all bundles
  const { data: memories, error: memoriesError } = await supabase
    .from("memories")
    .select("id, bundle_id, content")
    .in(
      "bundle_id",
      bundles.map((b) => b.id)
    );

  if (memoriesError) {
    console.error("[AutoForm] Failed to fetch memories:", memoriesError);
    return [];
  }

  // Group memories by bundle, only include bundles with memories
  const bundlesWithMemories = bundles
    .map((bundle) => ({
      id: bundle.id,
      name: bundle.name,
      icon: bundle.icon,
      memories: (memories || [])
        .filter((m) => m.bundle_id === bundle.id)
        .map((m) => ({ id: m.id, content: m.content })),
    }))
    .filter((b) => b.memories.length > 0);

  return bundlesWithMemories;
}

/**
 * Format memories for inclusion in Gemini prompts
 * Returns a formatted string or empty string if no memories
 */
export function formatMemoriesForPrompt(bundles: MemoryBundle[]): string {
  if (bundles.length === 0) {
    return "";
  }

  const sections = bundles.map((bundle) => {
    const items = bundle.memories.map((m) => `- ${m.content}`).join("\n");
    return `### ${bundle.icon} ${bundle.name}\n${items}`;
  });

  return `## User's Saved Memory
The following information has been saved by the user for auto-fill. Use this to answer questions when relevant.

${sections.join("\n\n")}`;
}

/**
 * Get formatted memory context for a user (combines fetch + format)
 */
export async function getMemoryContext(userId: string): Promise<string> {
  const bundles = await getUserMemories(userId);
  return formatMemoriesForPrompt(bundles);
}
