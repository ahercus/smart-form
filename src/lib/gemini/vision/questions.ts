import { getFastModel, generateQuestionsWithFlash, withTimeout } from "../client";
import { buildQuestionGenerationPrompt } from "../prompts";
import { questionGenerationSchema, answerParsingSchema } from "../schemas";
import type {
  ExtractedField,
  GeminiMessage,
  QuestionGenerationResult,
  NormalizedCoordinates,
  FieldType,
  ChoiceOption,
} from "../../types";

function parseGeminiResponse(text: string): QuestionGenerationResult {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      questions: parsed.questions || [],
      autoAnswered: parsed.autoAnswered || [],
      skippedFields: parsed.skippedFields || [],
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse Gemini response:", {
      error,
      text: cleaned.slice(0, 500),
    });
    return {
      questions: [],
      autoAnswered: [],
      skippedFields: [],
    };
  }
}

interface GenerateQuestionsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  fields: ExtractedField[];
  conversationHistory: GeminiMessage[];
  contextNotes?: string;
  memoryContext?: string;
}

export async function generateQuestionsForPage(
  params: GenerateQuestionsParams
): Promise<QuestionGenerationResult> {
  const {
    documentId,
    pageNumber,
    fields,
    conversationHistory,
    contextNotes,
    memoryContext,
  } = params;

  console.log(`[AutoForm] Generating questions for page ${pageNumber} (Flash, no vision):`, {
    documentId,
    fieldCount: fields.length,
    historyLength: conversationHistory.length,
  });

  try {
    const prompt = buildQuestionGenerationPrompt(
      pageNumber,
      fields,
      conversationHistory,
      contextNotes,
      memoryContext
    );

    console.log(`[AutoForm] Calling Gemini Flash API for page ${pageNumber}...`);

    const text = await withTimeout(
      generateQuestionsWithFlash({ prompt, responseSchema: questionGenerationSchema }),
      30000,
      `Question generation for page ${pageNumber}`
    );

    console.log(`[AutoForm] Gemini Flash response for page ${pageNumber}:`, {
      documentId,
      responseLength: text.length,
      responsePreview: text.slice(0, 200),
    });

    const parsed = parseGeminiResponse(text);

    console.log(`[AutoForm] Parsed questions for page ${pageNumber}:`, {
      documentId,
      questionCount: parsed.questions.length,
      autoAnsweredCount: parsed.autoAnswered.length,
      skippedCount: parsed.skippedFields.length,
    });

    return parsed;
  } catch (error) {
    console.error(`[AutoForm] Gemini Flash API error for page ${pageNumber}:`, {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
