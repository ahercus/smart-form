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
    // Reverted to stable API - v1alpha with media_resolution was timing out
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
  /** JSON schema to constrain output - prevents model from inventing values */
  responseSchema?: Record<string, unknown>;
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
  let { prompt, imageParts, thinkingLevel = ThinkingLevel.LOW, jsonOutput = false, responseSchema } = options;

  // Pro only supports LOW and HIGH - map others to LOW
  if (thinkingLevel === ThinkingLevel.MINIMAL || thinkingLevel === ThinkingLevel.MEDIUM) {
    thinkingLevel = ThinkingLevel.LOW;
  }

  // Build contents with image parts
  // Note: mediaResolution requires v1alpha which was timing out, reverted to stable API
  const contents = imageParts
    ? [{ text: prompt }, ...imageParts.map((p) => ({ inlineData: p.inlineData }))]
    : prompt;

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingLevel,
      includeThoughts: true, // Enable thought summaries for debugging QC decisions
    },
  };

  // Only set responseMimeType for JSON output to avoid breaking text responses
  if (jsonOutput || responseSchema) {
    config.responseMimeType = "application/json";
  }

  // Add response schema for structured outputs - constrains model to allowed values
  if (responseSchema) {
    config.responseJsonSchema = responseSchema;
  }

  const startTime = Date.now();
  const response = await client.models.generateContent({
    model: GEMINI_PRO,
    contents,
    config,
  });
  const duration = Date.now() - startTime;
  console.log(`[AutoForm] Gemini Pro API call completed in ${duration}ms`);

  // Log thinking/reasoning if available (helps debug QC decisions)
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.thought && part.text) {
        // Log full thinking content for debugging coordinate decisions
        console.log("[AutoForm] Pro Thinking:", {
          thoughtLength: part.text.length,
          thought: part.text.slice(0, 500), // First 500 chars
        });
      }
    }
  }

  // Log token usage for efficiency tracking
  if (response.usageMetadata) {
    console.log("[AutoForm] Gemini Token Usage:", {
      promptTokens: response.usageMetadata.promptTokenCount,
      responseTokens: response.usageMetadata.candidatesTokenCount,
      thinkingTokens: response.usageMetadata.thoughtsTokenCount,
      totalTokens: response.usageMetadata.totalTokenCount,
    });
  }

  return response.text || "";
}

/**
 * Generate content with Gemini 3 Flash (minimal thinking for fast parsing)
 * Use for: Answer parsing, question re-evaluation
 */
export async function generateFast(options: GenerateContentOptions) {
  const client = getGeminiClient();
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL, jsonOutput = false, responseSchema } = options;

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingLevel,
      includeThoughts: true, // Enable thought traces for debugging
    },
  };

  // Only set responseMimeType for JSON output
  if (jsonOutput || responseSchema) {
    config.responseMimeType = "application/json";
  }

  // Add response schema for structured outputs - constrains model to allowed values
  if (responseSchema) {
    config.responseJsonSchema = responseSchema;
  }

  const startTime = Date.now();
  const response = await client.models.generateContent({
    model: GEMINI_FLASH,
    contents: prompt,
    config,
  });
  const duration = Date.now() - startTime;
  console.log(`[AutoForm] Gemini Flash (text) API call completed in ${duration}ms`);

  // Log thinking/reasoning if available
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.thought && part.text) {
        console.log("[AutoForm] Flash Thinking:", {
          thoughtLength: part.text.length,
          thought: part.text.slice(0, 500), // First 500 chars
        });
      }
    }
  }

  // Log token usage
  if (response.usageMetadata) {
    console.log("[AutoForm] Flash Token Usage:", {
      promptTokens: response.usageMetadata.promptTokenCount,
      responseTokens: response.usageMetadata.candidatesTokenCount,
      thinkingTokens: response.usageMetadata.thoughtsTokenCount || 0,
      totalTokens: response.usageMetadata.totalTokenCount,
    });
  }

  return response.text || "";
}

/**
 * Generate content with Gemini 3 Flash + Vision (fast QC)
 * Use for: Field QC where we need image analysis but want speed
 *
 * Flash is ~5-10x faster than Pro for vision tasks with similar accuracy for QC
 */
export async function generateWithVisionFast(options: GenerateContentOptions) {
  const client = getGeminiClient();
  // Use LOW for better coordinate accuracy (MINIMAL had 0 thinking tokens)
  const { prompt, imageParts, thinkingLevel = ThinkingLevel.LOW, jsonOutput = false, responseSchema } = options;

  const contents = imageParts
    ? [{ text: prompt }, ...imageParts.map((p) => ({ inlineData: p.inlineData }))]
    : prompt;

  const config: Record<string, unknown> = {
    thinkingConfig: {
      thinkingLevel,
      includeThoughts: true, // Enable thought traces for debugging
    },
    // Disable safety filters for form analysis - forms contain sensitive field labels
    // like "Gender", "Date of Birth", "Race", "Social Security" that trigger false positives
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
    ],
  };

  // Only set responseMimeType for JSON output to avoid breaking text responses
  if (jsonOutput || responseSchema) {
    config.responseMimeType = "application/json";
  }

  // Add response schema for structured outputs - constrains model to allowed values
  if (responseSchema) {
    config.responseJsonSchema = responseSchema;
  }

  const startTime = Date.now();
  const response = await client.models.generateContent({
    model: GEMINI_FLASH,
    contents,
    config,
  });
  const duration = Date.now() - startTime;
  console.log(`[AutoForm] Gemini Flash (vision) API call completed in ${duration}ms`);

  // Debug: Log response structure to diagnose missing thoughts
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    console.log("[AutoForm] Flash Vision Parts Debug:", {
      partsCount: candidate.content.parts.length,
      parts: candidate.content.parts.map((p: any, i: number) => ({
        index: i,
        hasThought: !!p.thought,
        hasText: !!p.text,
        hasThoughtSignature: !!p.thoughtSignature,
        type: p.type, // Check for ThoughtContent format
        textLength: p.text?.length || 0,
        keys: Object.keys(p), // See all available fields
      })),
    });

    // Log thinking/reasoning if available
    for (const part of candidate.content.parts) {
      if (part.thought && part.text) {
        console.log("[AutoForm] Flash Vision Thinking:", {
          thoughtLength: part.text.length,
          thought: part.text.slice(0, 500), // First 500 chars
        });
      }
    }
  }

  // Log token usage for efficiency tracking
  if (response.usageMetadata) {
    console.log("[AutoForm] Flash Vision Token Usage:", {
      promptTokens: response.usageMetadata.promptTokenCount,
      responseTokens: response.usageMetadata.candidatesTokenCount,
      thinkingTokens: response.usageMetadata.thoughtsTokenCount || 0,
      totalTokens: response.usageMetadata.totalTokenCount,
    });
  }

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

/**
 * Fast Vision model for QC - uses Flash instead of Pro
 * ~5-10x faster with similar accuracy for field review tasks
 *
 * @param responseSchema - Optional JSON schema to constrain output values (e.g., limit fieldType to allowed types)
 */
export function getVisionModelFast(responseSchema?: Record<string, unknown>) {
  return {
    async generateContent(parts: unknown[]) {
      const prompt = typeof parts[0] === "string" ? parts[0] : "";
      const imageParts = parts.slice(1).filter(
        (p): p is { inlineData: { data: string; mimeType: string } } =>
          typeof p === "object" && p !== null && "inlineData" in p
      );

      const text = await generateWithVisionFast({ prompt, imageParts, jsonOutput: true, responseSchema });
      return { response: { text: () => text } };
    },
  };
}

/**
 * Fast text model for parsing - uses Flash
 *
 * @param responseSchema - Optional JSON schema to constrain output values
 */
export function getFastModel(responseSchema?: Record<string, unknown>) {
  return {
    async generateContent(prompt: string) {
      const text = await generateFast({ prompt, jsonOutput: true, responseSchema });
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
  responseSchema?: Record<string, unknown>;
}): Promise<string> {
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL, responseSchema } = options;

  return generateFast({
    prompt,
    thinkingLevel,
    jsonOutput: true,
    responseSchema,
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
