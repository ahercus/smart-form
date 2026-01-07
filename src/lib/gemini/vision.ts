// Gemini Vision for field review and question generation from PDF page images
//
// ARCHITECTURE NOTE: Question generation now uses Flash (text-only) instead of Pro+Vision
// because we already have all field data from Azure. Vision adds latency without value.
// Vision is still used for Field QC where image analysis is actually needed.

import {
  getVisionModelFast,
  getFastModel,
  generateQuestionsWithFlash,
  withTimeout,
} from "./client";
import { buildFieldReviewPrompt, buildFieldDiscoveryPrompt, buildQuestionGenerationPrompt } from "./prompts";
import { compositeFieldsOntoImage, cropAndCompositeQuadrant, type QuadrantBounds } from "../image-compositor";
import type {
  ExtractedField,
  GeminiMessage,
  QuestionGenerationResult,
  NormalizedCoordinates,
  FieldType,
  ChoiceOption,
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
      choiceOptions: ChoiceOption[];
    }>;
  }>;
  newFields: Array<{
    label: string;
    fieldType: FieldType;
    coordinates: NormalizedCoordinates;
    choiceOptions?: ChoiceOption[];
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

    // Use Flash for QC - ~5-10x faster than Pro with similar accuracy
    const model = getVisionModelFast();
    const prompt = buildFieldReviewPrompt(pageNumber, fields, hasDocumentAIFields);

    const imagePart = {
      inlineData: {
        data: composited.imageBase64,
        mimeType: "image/png",
      },
    };

    console.log(`[AutoForm] Calling Gemini Vision for field review...`);

    // No timeout for now - let it complete so we can see thinking tokens and timing
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

interface ReviewQuadrantParams extends ReviewFieldsParams {
  quadrantBounds: QuadrantBounds;
  quadrantIndex: number;
}

/**
 * Review a specific quadrant of a page using Gemini Vision
 * Coordinates in results are relative to the quadrant and must be mapped back to page coordinates
 */
export async function reviewQuadrantWithVision(
  params: ReviewQuadrantParams
): Promise<FieldReviewResult & { quadrantBounds: QuadrantBounds; durationMs: number }> {
  const { documentId, pageNumber, pageImageBase64, fields, quadrantBounds, quadrantIndex } = params;
  const startTime = Date.now();

  console.log(`[AutoForm] Cluster ${quadrantIndex} QC start (page ${pageNumber}):`, {
    fieldCount: fields.length,
    bounds: `${quadrantBounds.left.toFixed(0)}-${quadrantBounds.right.toFixed(0)}%, ${quadrantBounds.top.toFixed(0)}-${quadrantBounds.bottom.toFixed(0)}%`,
  });

  try {
    // Crop and composite the quadrant
    const composited = await cropAndCompositeQuadrant({
      imageBase64: pageImageBase64,
      fields,
      bounds: quadrantBounds,
      showGrid: true,
      gridSpacing: 10,
    });

    const cropDuration = Date.now() - startTime;

    const model = getVisionModelFast();
    const prompt = buildFieldReviewPrompt(pageNumber, fields, fields.length > 0);

    const imagePart = {
      inlineData: {
        data: composited.imageBase64,
        mimeType: "image/png",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    const totalDuration = Date.now() - startTime;

    console.log(`[AutoForm] Cluster ${quadrantIndex} QC complete (page ${pageNumber}):`, {
      durationMs: totalDuration,
      cropMs: cropDuration,
      geminiMs: totalDuration - cropDuration,
      responseLength: text.length,
    });

    // Parse and return with bounds for coordinate mapping
    const parsed = parseFieldReviewResponse(text);

    // Map coordinates back from quadrant-relative to page-relative
    const mappedResult = mapQuadrantResultsToPage(parsed, quadrantBounds);

    return {
      ...mappedResult,
      quadrantBounds,
      durationMs: totalDuration,
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[AutoForm] Cluster ${quadrantIndex} QC failed (page ${pageNumber}):`, {
      durationMs: totalDuration,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
      quadrantBounds,
      durationMs: totalDuration,
    };
  }
}

/**
 * Map quadrant-relative coordinates back to page-relative coordinates
 */
function mapQuadrantResultsToPage(
  result: FieldReviewResult,
  bounds: QuadrantBounds
): FieldReviewResult {
  const quadrantWidth = bounds.right - bounds.left;
  const quadrantHeight = bounds.bottom - bounds.top;

  // Map adjustment coordinates
  const mappedAdjustments = result.adjustments.map((adj) => {
    if (!adj.changes?.coordinates) return adj;

    const coords = adj.changes.coordinates;
    return {
      ...adj,
      changes: {
        ...adj.changes,
        coordinates: {
          left: bounds.left + (coords.left / 100) * quadrantWidth,
          top: bounds.top + (coords.top / 100) * quadrantHeight,
          width: (coords.width / 100) * quadrantWidth,
          height: (coords.height / 100) * quadrantHeight,
        },
      },
    };
  });

  // Map new field coordinates
  const mappedNewFields = result.newFields.map((field) => ({
    ...field,
    coordinates: {
      left: bounds.left + (field.coordinates.left / 100) * quadrantWidth,
      top: bounds.top + (field.coordinates.top / 100) * quadrantHeight,
      width: (field.coordinates.width / 100) * quadrantWidth,
      height: (field.coordinates.height / 100) * quadrantHeight,
    },
    // Also map choice option coordinates if present
    choiceOptions: field.choiceOptions?.map((opt) => ({
      ...opt,
      coordinates: {
        left: bounds.left + (opt.coordinates.left / 100) * quadrantWidth,
        top: bounds.top + (opt.coordinates.top / 100) * quadrantHeight,
        width: (opt.coordinates.width / 100) * quadrantWidth,
        height: (opt.coordinates.height / 100) * quadrantHeight,
      },
    })),
  }));

  return {
    ...result,
    adjustments: mappedAdjustments,
    newFields: mappedNewFields,
  };
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

interface DiscoverFieldsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  existingFieldIds: string[];
}

/**
 * Discovery-only scan: Find fields that Azure missed
 * Runs on full page image, only returns newFields (no adjustments)
 */
export async function discoverMissedFields(
  params: DiscoverFieldsParams
): Promise<FieldReviewResult & { durationMs: number }> {
  const { documentId, pageNumber, pageImageBase64, existingFieldIds } = params;
  const startTime = Date.now();

  console.log(`[AutoForm] Discovery scan start (page ${pageNumber}):`, {
    existingFieldCount: existingFieldIds.length,
  });

  try {
    // Use full page with field overlays (so Gemini can see what's already detected)
    // We need to get the fields to draw their overlays
    const model = getVisionModelFast();
    const prompt = buildFieldDiscoveryPrompt(pageNumber, existingFieldIds);

    // For discovery, we composite existing fields onto the image
    // so Gemini can see what's already detected and skip those
    const imagePart = {
      inlineData: {
        data: pageImageBase64,
        mimeType: "image/png",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    const totalDuration = Date.now() - startTime;

    console.log(`[AutoForm] Discovery scan complete (page ${pageNumber}):`, {
      durationMs: totalDuration,
      responseLength: text.length,
      newFieldsFound: parseFieldReviewResponse(text).newFields.length,
    });

    const parsed = parseFieldReviewResponse(text);

    // Discovery only returns newFields - clear any accidental adjustments/removals
    return {
      adjustments: [],
      newFields: parsed.newFields,
      removeFields: [],
      fieldsValidated: parsed.fieldsValidated,
      durationMs: totalDuration,
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[AutoForm] Discovery scan failed (page ${pageNumber}):`, {
      durationMs: totalDuration,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
      durationMs: totalDuration,
    };
  }
}

interface GenerateQuestionsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string; // Kept for backward compatibility, but NOT USED
  fields: ExtractedField[];
  conversationHistory: GeminiMessage[];
  contextNotes?: string;
  memoryContext?: string;
}

/**
 * Generate questions for a page using Flash model (text-only, no vision)
 *
 * WHY NO VISION FOR QUESTION GENERATION:
 * We removed Gemini Vision from question generation because:
 *
 * 1. We have all the data we need:
 *    - field.label (from Azure)
 *    - field.type (from Azure)
 *    - field.coordinates (not needed for questions)
 *    - conversation history (what user already told us)
 *
 * 2. Vision adds latency:
 *    - Pro+Vision: 3-5s per page
 *    - Flash text-only: 1-2s per page
 *
 * 3. Vision adds cost:
 *    - Vision API calls are 10x more expensive
 *
 * 4. Vision doesn't add value for questions:
 *    - Questions are about "what's your name?" not "where is the name field?"
 *    - Field labels tell us what to ask
 *
 * When vision IS needed:
 * - Field QC (verifying coordinates are correct)
 * - Adding missed fields (seeing what Azure didn't detect)
 * - These still use vision in reviewFieldsWithVision()
 */
export async function generateQuestionsForPage(
  params: GenerateQuestionsParams
): Promise<QuestionGenerationResult> {
  const {
    documentId,
    pageNumber,
    // pageImageBase64 intentionally not used - we use text-only Flash
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

    // Use Flash with timeout protection (30s)
    const text = await withTimeout(
      generateQuestionsWithFlash({ prompt }),
      30000,
      `Question generation for page ${pageNumber}`
    );

    console.log(`[AutoForm] Gemini Flash response for page ${pageNumber}:`, {
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
    console.error(`[AutoForm] Gemini Flash API error for page ${pageNumber}:`, {
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

export interface ParseAnswerResult {
  confident: boolean;
  warning?: string;
  parsedValues: ParsedFieldValue[];
  /** Field IDs that still need values (partial fill scenario) */
  missingFields?: string[];
  /** Suggested follow-up question for missing fields */
  followUpQuestion?: string;
}

/**
 * Parse a user's natural language answer and distribute values across multiple fields
 * e.g., "Jude Hercus 9/12/2022 he/him" → First Name: "Jude", Last Name: "Hercus", DOB: "9/12/2022", Pronouns: "he/him"
 *
 * Returns confidence flag and optional warning - if not confident, values will be empty
 */
export async function parseAnswerForFields(
  params: ParseAnswerParams
): Promise<ParseAnswerResult> {
  const { question, answer, fields } = params;

  // If only one field, format the value but no parsing needed
  if (fields.length === 1) {
    const field = fields[0];

    // Skip formatting for signatures/images (data URLs)
    if (answer.startsWith("data:")) {
      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: answer }],
      };
    }

    try {
      const model = getFastModel();
      const { buildSingleFieldFormattingPrompt } = await import("./prompts");
      const prompt = buildSingleFieldFormattingPrompt(answer, {
        label: field.label,
        fieldType: field.fieldType,
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      let cleaned = text.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);

      const parsed = JSON.parse(cleaned.trim());
      const formattedValue = parsed.value ?? answer;

      console.log("[AutoForm] Single field formatted:", {
        fieldLabel: field.label,
        input: answer.slice(0, 30),
        output: formattedValue.slice(0, 30),
      });

      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: formattedValue }],
      };
    } catch (error) {
      console.error("[AutoForm] Single field formatting failed:", error);
      // Fall back to raw answer
      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: answer }],
      };
    }
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
    const confident = parsed.confident !== false; // Default to true for backwards compat
    const warning = parsed.warning;
    const parsedValues = parsed.parsedValues || [];
    const missingFields = parsed.missingFields || [];
    const followUpQuestion = parsed.followUpQuestion;

    console.log("[AutoForm] Answer parsed:", {
      confident,
      warning,
      inputAnswer: answer,
      outputFields: parsedValues.length,
      missingFieldCount: missingFields.length,
      hasFollowUp: !!followUpQuestion,
      values: parsedValues.map((v: ParsedFieldValue) => ({
        label: fields.find((f) => f.id === v.fieldId)?.label,
        value: v.value?.slice(0, 20) || "",
      })),
    });

    return { confident, warning, parsedValues, missingFields, followUpQuestion };
  } catch (error) {
    console.error("[AutoForm] Answer parsing failed:", error);
    // Return empty values with warning - never dump raw answer to all fields
    return {
      confident: false,
      warning: "Failed to parse answer. Please try rephrasing.",
      parsedValues: fields.map((f) => ({ fieldId: f.id, value: "" })),
      missingFields: fields.map((f) => f.id),
    };
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
