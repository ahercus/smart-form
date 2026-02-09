/**
 * Document-wide question generation using Gemini
 *
 * Single consolidated call that receives:
 * - All fields from all pages
 * - Full document OCR text
 * - User memory context
 *
 * Returns questions that can span multiple pages.
 */

import { generateQuestionsWithFlash, withTimeout } from "../client";
import { buildDocumentQuestionsPrompt, DOCUMENT_QUESTIONS_SCHEMA } from "../prompts/document-questions";
import type { ExtractedField, MemoryChoice } from "../../types";

export interface DetectedEntity {
  id: string;
  label: string;
  description?: string;
  fieldIds: string[];
}

export interface GeneratedQuestion {
  question: string;
  entityId?: string;
  fieldIds: string[];
  inputType: string;
  profileKey?: string;
  choices?: MemoryChoice[];
}

export interface AutoAnsweredField {
  fieldId: string;
  value: string;
  reasoning?: string;
}

export interface SkippedField {
  fieldId: string;
  reason: string;
}

export interface DocumentQuestionsResult {
  entities: DetectedEntity[];
  questions: GeneratedQuestion[];
  autoAnswered: AutoAnsweredField[];
  skippedFields: SkippedField[];
}

interface GenerateDocumentQuestionsParams {
  documentId: string;
  fields: ExtractedField[];
  ocrText: string;
  memoryContext: string;
  contextNotes?: string;
  clientDateTime?: string;
  clientTimeZone?: string;
  clientTimeZoneOffsetMinutes?: number;
}

function parseGeminiResponse(text: string): DocumentQuestionsResult {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      entities: parsed.entities || [],
      questions: parsed.questions || [],
      autoAnswered: parsed.autoAnswered || [],
      skippedFields: parsed.skippedFields || [],
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse document questions response:", {
      error,
      text: cleaned.slice(0, 500),
    });
    return {
      entities: [],
      questions: [],
      autoAnswered: [],
      skippedFields: [],
    };
  }
}

/**
 * Generates conversational questions from extracted fields.
 * Groups related fields by detected entity (e.g., Student, Parent, Emergency Contact),
 * incorporates saved memory as choice options, and auto-answers fields with direct matches.
 */
export async function generateDocumentQuestions(
  params: GenerateDocumentQuestionsParams
): Promise<DocumentQuestionsResult> {
  const {
    documentId,
    fields,
    ocrText,
    memoryContext,
    contextNotes,
    clientDateTime,
    clientTimeZone,
    clientTimeZoneOffsetMinutes,
  } = params;

  console.log("[AutoForm] Generating document-wide questions:", {
    documentId,
    fieldCount: fields.length,
    ocrTextLength: ocrText.length,
    hasMemory: !!memoryContext,
    hasContext: !!contextNotes,
  });

  try {
    const prompt = buildDocumentQuestionsPrompt({
      fields,
      ocrText,
      memoryContext,
      contextNotes,
      clientDateTime,
      clientTimeZone,
      clientTimeZoneOffsetMinutes,
    });

    console.log("[AutoForm] Calling Gemini Flash for document questions...");

    const text = await withTimeout(
      generateQuestionsWithFlash({
        prompt,
        responseSchema: DOCUMENT_QUESTIONS_SCHEMA,
      }),
      60000, // 60 second timeout for full document
      "Document question generation"
    );

    console.log("[AutoForm] Gemini response received:", {
      documentId,
      responseLength: text.length,
      responsePreview: text.slice(0, 300),
    });

    const parsed = parseGeminiResponse(text);

    console.log("[AutoForm] Document questions parsed:", {
      documentId,
      entitiesDetected: parsed.entities.length,
      questionsGenerated: parsed.questions.length,
      autoAnsweredCount: parsed.autoAnswered.length,
      skippedCount: parsed.skippedFields.length,
      entities: parsed.entities.map((e) => `${e.label} (${e.fieldIds.length} fields)`),
    });

    return parsed;
  } catch (error) {
    console.error("[AutoForm] Document question generation failed:", {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
