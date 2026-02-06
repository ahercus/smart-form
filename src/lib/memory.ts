// Memory utilities for AI context

import { createAdminClient } from "./supabase/admin";
import { getGeminiClient } from "./gemini/client";

export interface MemoryBundle {
  id: string;
  name: string;
  icon: string;
  memories: Array<{
    id: string;
    content: string;
  }>;
}

export interface ProfileCoreData {
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
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
 * Fetch user's profile core data
 */
export async function getUserProfile(userId: string): Promise<ProfileCoreData | null> {
  const supabase = createAdminClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("core_data")
    .eq("user_id", userId)
    .single();

  if (error || !profile) {
    return null;
  }

  return profile.core_data as ProfileCoreData | null;
}

/**
 * Format profile data for inclusion in Gemini prompts
 */
export function formatProfileForPrompt(profile: ProfileCoreData | null): string {
  if (!profile) {
    return "";
  }

  const lines: string[] = [];

  // Name
  const nameParts = [profile.firstName, profile.middleInitial, profile.lastName].filter(Boolean);
  if (nameParts.length > 0) {
    lines.push(`- Full Name: ${nameParts.join(" ")}`);
    if (profile.firstName) lines.push(`- First Name: ${profile.firstName}`);
    if (profile.middleInitial) lines.push(`- Middle Initial: ${profile.middleInitial}`);
    if (profile.lastName) lines.push(`- Last Name: ${profile.lastName}`);
  }

  // Contact
  if (profile.email) lines.push(`- Email: ${profile.email}`);
  if (profile.phone) lines.push(`- Phone: ${profile.phone}`);
  if (profile.dateOfBirth) lines.push(`- Date of Birth: ${profile.dateOfBirth}`);

  // Address
  const addressParts = [profile.street, profile.city, profile.state, profile.zip].filter(Boolean);
  if (addressParts.length > 0) {
    if (profile.street) lines.push(`- Street Address: ${profile.street}`);
    if (profile.city) lines.push(`- City: ${profile.city}`);
    if (profile.state) lines.push(`- State: ${profile.state}`);
    if (profile.zip) lines.push(`- ZIP Code: ${profile.zip}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `## User's Profile Information
The following is the user's (parent/guardian's) own information:
${lines.join("\n")}

IMPORTANT: Family members (children, spouse, etc.) likely share the user's last name unless explicitly stated otherwise in their memory entries.`;
}

/**
 * Get formatted memory context for a user (combines fetch + format)
 * Includes both profile data and saved memories
 */
export async function getMemoryContext(userId: string): Promise<string> {
  const [bundles, profile] = await Promise.all([
    getUserMemories(userId),
    getUserProfile(userId),
  ]);

  const profileSection = formatProfileForPrompt(profile);
  const memorySection = formatMemoriesForPrompt(bundles);

  const sections = [profileSection, memorySection].filter(Boolean);
  return sections.join("\n\n");
}

/**
 * Use AI to categorize a memory into the most appropriate bundle
 */
export async function categorizeMemory(
  content: string,
  sourceQuestion: string | undefined,
  bundles: Array<{ id: string; name: string; icon: string }>
): Promise<{ bundleId: string; bundleName: string }> {
  // Default to first bundle if AI fails
  const defaultBundle = bundles[0];

  try {
    const client = getGeminiClient();

    const bundleList = bundles
      .map((b) => `- ${b.name} (${b.icon})`)
      .join("\n");

    const prompt = `Categorize this information into the most appropriate category.

Categories available:
${bundleList}

Information to categorize:
${sourceQuestion ? `Question: "${sourceQuestion}"` : ""}
Answer: "${content}"

Rules:
- "Family" is for info about children, spouse, family members, dependents
- "Work" is for employment, employer, job, professional info
- "Medical" is for health conditions, allergies, medications, doctor info
- "Education" is for schools, grades, academic info
- "Contact" is for addresses, phone numbers, emails
- Pick the MOST specific category that fits
- If unsure, pick "Personal" or the first available category

Return ONLY the exact category name, nothing else. Example: "Family"`;

    const startTime = Date.now();
    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const duration = Date.now() - startTime;
    console.log(`[AutoForm] Gemini Flash (memory categorize) API call completed in ${duration}ms`);

    const categoryName = response.text?.trim();

    // Find the bundle that matches the category name
    const matchedBundle = bundles.find(
      (b) => b.name.toLowerCase() === categoryName?.toLowerCase()
    );

    if (matchedBundle) {
      console.log("[AutoForm] Memory categorized:", {
        content: content.slice(0, 50),
        category: matchedBundle.name,
      });
      return { bundleId: matchedBundle.id, bundleName: matchedBundle.name };
    }

    // Fallback to default bundle
    console.log("[AutoForm] Memory category not matched, using default:", {
      aiResponse: categoryName,
      defaultCategory: defaultBundle.name,
    });
    return { bundleId: defaultBundle.id, bundleName: defaultBundle.name };
  } catch (error) {
    console.error("[AutoForm] Failed to categorize memory:", error);
    return { bundleId: defaultBundle.id, bundleName: defaultBundle.name };
  }
}

/**
 * Prepare memory content by cleaning up raw user input using AI
 * Removes filler words, formats dates consistently, creates scannable entries
 */
export async function prepareMemoryContent(
  rawContent: string,
  sourceQuestion?: string
): Promise<string> {
  // If content is already clean/short, skip AI processing
  const wordCount = rawContent.trim().split(/\s+/).length;
  if (wordCount <= 5) {
    return rawContent.trim();
  }

  try {
    const client = getGeminiClient();

    const prompt = sourceQuestion
      ? `Clean up this answer for storage as a reusable memory entry.

Question that was answered: "${sourceQuestion}"

Raw answer: "${rawContent}"

Create a concise, scannable memory entry:
- Remove filler words (um, uh, like, you know, etc.)
- Format dates consistently (e.g., "March 15, 2017")
- Keep all factual information
- Use a clean format like "Name - Born: Date - Gender: X" for people
- Keep it brief but complete

Return ONLY the cleaned text, nothing else.`
      : `Clean up this text for storage as a memory entry:

"${rawContent}"

- Remove filler words
- Format dates consistently
- Keep all factual information
- Make it scannable and reusable

Return ONLY the cleaned text, nothing else.`;

    const startTime = Date.now();
    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const duration = Date.now() - startTime;
    console.log(`[AutoForm] Gemini Flash (memory prepare) API call completed in ${duration}ms`);

    const cleanedContent = response.text?.trim();

    // Fallback to original if AI returns empty or fails
    if (!cleanedContent || cleanedContent.length < 3) {
      return rawContent.trim();
    }

    console.log("[AutoForm] Memory content prepared:", {
      original: rawContent.slice(0, 50),
      cleaned: cleanedContent.slice(0, 50),
    });

    return cleanedContent;
  } catch (error) {
    console.error("[AutoForm] Failed to prepare memory content:", error);
    // Fallback to original content on error
    return rawContent.trim();
  }
}
