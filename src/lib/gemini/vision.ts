// Gemini Vision for field review and question generation from PDF page images

import { getVisionModel, getFastModel } from "./client";
import { buildFieldReviewPrompt, buildQuestionGenerationPrompt } from "./prompts";
import { compositeFieldsOntoImage } from "../image-compositor";
import type {
  ExtractedField,
  GeminiMessage,
  QuestionGenerationResult,
  NormalizedCoordinates,
  FieldType,
} from "../types";

// Field review result from Gemini Vision QC
export interface FieldReviewResult {
  adjustments: Array<{
    fieldId: string;
    action: "update";
    changes: Partial<{
      label: string;
      fieldType: FieldType;
      coordinates: NormalizedCoordinates;
    }>;
  }>;
  newFields: Array<{
    label: string;
    fieldType: FieldType;
    coordinates: NormalizedCoordinates;
  }>;
  removeFields: string[];
  fieldsValidated: boolean;
}

interface ReviewFieldsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  fields: ExtractedField[];
}

/**
 * Review and QC detected fields using Gemini Vision
 * Sends a composite image (page + field overlays) to Gemini for validation
 */
export async function reviewFieldsWithVision(
  params: ReviewFieldsParams
): Promise<FieldReviewResult> {
  const { documentId, pageNumber, pageImageBase64, fields } = params;
  const hasDocumentAIFields = fields.length > 0;

  console.log(`[AutoForm] Reviewing fields for page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    mode: hasDocumentAIFields ? "QC" : "full-detection",
  });

  try {
    // Create composite image with field overlays (or just grid if no fields)
    const composited = await compositeFieldsOntoImage({
      imageBase64: pageImageBase64,
      fields,
      showGrid: true,
      gridSpacing: 10,
    });

    console.log(`[AutoForm] Composite image created:`, {
      documentId,
      pageNumber,
      dimensions: `${composited.width}x${composited.height}`,
    });

    const model = getVisionModel();
    const prompt = buildFieldReviewPrompt(pageNumber, fields, hasDocumentAIFields);

    const imagePart = {
      inlineData: {
        data: composited.imageBase64,
        mimeType: "image/png",
      },
    };

    console.log(`[AutoForm] Calling Gemini Vision for field review...`);
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    console.log(`[AutoForm] Gemini Vision field review response:`, {
      documentId,
      pageNumber,
      responseLength: text.length,
      responsePreview: text.slice(0, 200),
    });

    // Parse the response
    return parseFieldReviewResponse(text);
  } catch (error) {
    console.error(`[AutoForm] Field review failed for page ${pageNumber}:`, {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    // Return empty result on error - don't fail the whole flow
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
    };
  }
}

function parseFieldReviewResponse(text: string): FieldReviewResult {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      adjustments: parsed.adjustments || [],
      newFields: parsed.newFields || [],
      removeFields: parsed.removeFields || [],
      fieldsValidated: parsed.fieldsValidated ?? true,
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse field review response:", {
      error,
      text: cleaned.slice(0, 500),
    });
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
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
}

export async function generateQuestionsForPage(
  params: GenerateQuestionsParams
): Promise<QuestionGenerationResult> {
  const {
    documentId,
    pageNumber,
    pageImageBase64,
    fields,
    conversationHistory,
    contextNotes,
  } = params;

  console.log(`[AutoForm] Generating questions for page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    historyLength: conversationHistory.length,
    imageSize: pageImageBase64.length,
  });

  try {
    const model = getVisionModel();
    const prompt = buildQuestionGenerationPrompt(
      pageNumber,
      fields,
      conversationHistory,
      contextNotes
    );

    const imagePart = {
      inlineData: {
        data: pageImageBase64,
        mimeType: "image/png",
      },
    };

    console.log(`[AutoForm] Calling Gemini Vision API for page ${pageNumber}...`);
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    console.log(`[AutoForm] Gemini response for page ${pageNumber}:`, {
      documentId,
      responseLength: text.length,
      responsePreview: text.slice(0, 200),
    });

    // Parse the JSON response
    const parsed = parseGeminiResponse(text);

    console.log(`[AutoForm] Parsed questions for page ${pageNumber}:`, {
      documentId,
      questionCount: parsed.questions.length,
      autoAnsweredCount: parsed.autoAnswered.length,
      skippedCount: parsed.skippedFields.length,
    });

    return parsed;
  } catch (error) {
    console.error(`[AutoForm] Gemini Vision API error for page ${pageNumber}:`, {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

function parseGeminiResponse(text: string): QuestionGenerationResult {
  // Remove markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
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

interface ParseAnswerParams {
  question: string;
  answer: string;
  fields: Array<{ id: string; label: string; fieldType: string }>;
}

export interface ParsedFieldValue {
  fieldId: string;
  value: string;
}

/**
 * Parse a user's natural language answer and distribute values across multiple fields
 * e.g., "Jude Hercus 9/12/2022 he/him" → First Name: "Jude", Last Name: "Hercus", DOB: "9/12/2022", Pronouns: "he/him"
 */
export async function parseAnswerForFields(
  params: ParseAnswerParams
): Promise<ParsedFieldValue[]> {
  const { question, answer, fields } = params;

  // If only one field, no need to parse - use answer directly
  if (fields.length === 1) {
    return [{ fieldId: fields[0].id, value: answer }];
  }

  console.log("[AutoForm] Parsing answer for multiple fields:", {
    question: question.slice(0, 50),
    answer: answer.slice(0, 50),
    fieldCount: fields.length,
    fieldLabels: fields.map((f) => f.label),
  });

  try {
    // Use fast model with minimal thinking for quick parsing
    const model = getFastModel();
    const { buildAnswerParsingPrompt } = await import("./prompts");
    const prompt = buildAnswerParsingPrompt(question, answer, fields);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse the JSON response
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }

    const parsed = JSON.parse(cleaned.trim());
    const parsedValues = parsed.parsedValues || [];

    console.log("[AutoForm] Answer parsed successfully:", {
      inputAnswer: answer,
      outputFields: parsedValues.length,
      values: parsedValues.map((v: ParsedFieldValue) => ({
        label: fields.find((f) => f.id === v.fieldId)?.label,
        value: v.value.slice(0, 20),
      })),
    });

    return parsedValues;
  } catch (error) {
    console.error("[AutoForm] Answer parsing failed:", error);
    // Fallback: apply the same answer to all fields (old behavior)
    return fields.map((f) => ({ fieldId: f.id, value: answer }));
  }
}

interface ReevaluateParams {
  newAnswer: { question: string; answer: string };
  pendingQuestions: Array<{ id: string; question: string; fieldIds: string[] }>;
  fields: ExtractedField[];
}

export async function reevaluatePendingQuestions(
  params: ReevaluateParams
): Promise<Array<{ questionId: string; answer: string; reasoning: string }>> {
  const { newAnswer, pendingQuestions, fields } = params;

  if (pendingQuestions.length === 0) {
    return [];
  }

  console.log("[AutoForm] Re-evaluating pending questions after new answer:", {
    newQuestion: newAnswer.question,
    pendingCount: pendingQuestions.length,
  });

  // Use fast model for quick re-evaluation
  const model = getFastModel();

  const { buildAnswerReevaluationPrompt } = await import("./prompts");
  const prompt = buildAnswerReevaluationPrompt(
    newAnswer,
    pendingQuestions,
    fields
  );

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  // Parse the response
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  try {
    const parsed = JSON.parse(cleaned.trim());
    return parsed.autoAnswer || [];
  } catch {
    console.error("[AutoForm] Failed to parse reevaluation response");
    return [];
  }
}
