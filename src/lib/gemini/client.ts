// Gemini SDK initialization
// Using different models/thinking levels for different tasks:
// - Pro (high thinking): Complex analysis like grid/field review
// - Flash (minimal thinking): Fast parsing tasks

import { GoogleGenAI, ThinkingLevel } from "@google/genai";

let genAI: GoogleGenAI | null = null;

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[AutoForm] Missing GEMINI_API_KEY environment variable. " +
        "Gemini integration requires a valid API key."
    );
  }
  return apiKey;
}

export function getGeminiClient(): GoogleGenAI {
  if (!genAI) {
    const apiKey = getApiKey();
    genAI = new GoogleGenAI({ apiKey });
    console.log("[AutoForm] Gemini client initialized");
  }
  return genAI;
}

// Model names
const GEMINI_PRO = "gemini-3-pro-preview";
const GEMINI_FLASH = "gemini-3-flash-preview";

interface GenerateContentOptions {
  prompt: string;
  imageParts?: Array<{ inlineData: { data: string; mimeType: string } }>;
  thinkingLevel?: ThinkingLevel;
  /** Set to true to force JSON output (for structured data extraction) */
  jsonOutput?: boolean;
}

/**
 * Generate content with Gemini 3 Pro (configurable thinking level)
 * Use for: Grid analysis, field review/QC, coordinate adjustments
 *
 * Gemini 3 Pro thinking levels (only these are supported):
 * - LOW: Minimizes latency and cost. Best for simple tasks.
 * - HIGH: Maximizes reasoning depth. Model may take longer but output is more carefully reasoned.
 *
 * Note: MINIMAL and MEDIUM are Flash-only and will be mapped to LOW for Pro.
 */
export async function generateWithVision(options: GenerateContentOptions) {
  const client = getGeminiClient();
  // Default to LOW for faster responses. Map MINIMAL/MEDIUM to LOW for Pro compatibility.
  let { prompt, imageParts, thinkingLevel = ThinkingLevel.LOW, jsonOutput = false } = options;

  // Pro only supports LOW and HIGH - map others to LOW
  if (thinkingLevel === ThinkingLevel.MINIMAL || thinkingLevel === ThinkingLevel.MEDIUM) {
    thinkingLevel = ThinkingLevel.LOW;
  }

  const contents = imageParts
    ? [{ text: prompt }, ...imageParts.map((p) => ({ inlineData: p.inlineData }))]
    : prompt;

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingLevel,
    },
  };

  // Only set responseMimeType for JSON output to avoid breaking text responses
  if (jsonOutput) {
    config.responseMimeType = "application/json";
  }

  const response = await client.models.generateContent({
    model: GEMINI_PRO,
    contents,
    config,
  });

  return response.text || "";
}

/**
 * Generate content with Gemini 3 Flash (minimal thinking for fast parsing)
 * Use for: Answer parsing, question re-evaluation
 */
export async function generateFast(options: GenerateContentOptions) {
  const client = getGeminiClient();
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL, jsonOutput = false } = options;

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingLevel,
    },
  };

  // Only set responseMimeType for JSON output
  if (jsonOutput) {
    config.responseMimeType = "application/json";
  }

  const response = await client.models.generateContent({
    model: GEMINI_FLASH,
    contents: prompt,
    config,
  });

  return response.text || "";
}

// Legacy exports for compatibility - these wrap the new API
// Note: These use jsonOutput: true because they're used by vision.ts which expects JSON
export function getVisionModel() {
  return {
    async generateContent(parts: unknown[]) {
      const prompt = typeof parts[0] === "string" ? parts[0] : "";
      const imageParts = parts.slice(1).filter(
        (p): p is { inlineData: { data: string; mimeType: string } } =>
          typeof p === "object" && p !== null && "inlineData" in p
      );

      const text = await generateWithVision({ prompt, imageParts, jsonOutput: true });
      return { response: { text: () => text } };
    },
  };
}

export function getFastModel() {
  return {
    async generateContent(prompt: string) {
      const text = await generateFast({ prompt, jsonOutput: true });
      return { response: { text: () => text } };
    },
  };
}

/**
 * Generate questions using Flash model (text-only, no vision)
 *
 * Why Flash: Question generation is pattern matching (field labels → questions)
 * Why no vision: We have field.label, field.type, field.coordinates already
 *
 * Speed: ~1-2s per page vs 3-5s with Pro+Vision
 * Cost: ~90% cheaper per request
 */
export async function generateQuestionsWithFlash(options: {
  prompt: string;
  thinkingLevel?: ThinkingLevel;
}): Promise<string> {
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL } = options;

  return generateFast({
    prompt,
    thinkingLevel,
    jsonOutput: true,
  });
}

/**
 * Wrap any promise with a timeout
 *
 * Why: Prevent hung API requests from blocking user forever
 * Timeout: 30s default (generous, but prevents infinite hangs)
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}
