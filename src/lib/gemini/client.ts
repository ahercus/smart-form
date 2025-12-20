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
}

/**
 * Generate content with Gemini 3 Pro (high thinking for complex analysis)
 * Use for: Grid analysis, field review/QC, coordinate adjustments
 */
export async function generateWithVision(options: GenerateContentOptions) {
  const client = getGeminiClient();
  const { prompt, imageParts, thinkingLevel = ThinkingLevel.HIGH } = options;

  const contents = imageParts
    ? [{ text: prompt }, ...imageParts.map((p) => ({ inlineData: p.inlineData }))]
    : prompt;

  const response = await client.models.generateContent({
    model: GEMINI_PRO,
    contents,
    config: {
      thinkingConfig: {
        thinkingLevel,
      },
    },
  });

  return response.text || "";
}

/**
 * Generate content with Gemini 3 Flash (minimal thinking for fast parsing)
 * Use for: Answer parsing, question re-evaluation
 */
export async function generateFast(options: GenerateContentOptions) {
  const client = getGeminiClient();
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL } = options;

  const response = await client.models.generateContent({
    model: GEMINI_FLASH,
    contents: prompt,
    config: {
      thinkingConfig: {
        thinkingLevel,
      },
    },
  });

  return response.text || "";
}

// Legacy exports for compatibility - these wrap the new API
export function getVisionModel() {
  return {
    async generateContent(parts: unknown[]) {
      const prompt = typeof parts[0] === "string" ? parts[0] : "";
      const imageParts = parts.slice(1).filter(
        (p): p is { inlineData: { data: string; mimeType: string } } =>
          typeof p === "object" && p !== null && "inlineData" in p
      );

      const text = await generateWithVision({ prompt, imageParts });
      return { response: { text: () => text } };
    },
  };
}

export function getFastModel() {
  return {
    async generateContent(prompt: string) {
      const text = await generateFast({ prompt });
      return { response: { text: () => text } };
    },
  };
}

/**
 * @deprecated Use generateWithVision() or generateFast() instead
 */
export function getTextModel() {
  return getFastModel();
}
