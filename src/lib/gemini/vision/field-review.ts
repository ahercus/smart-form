import {
  getVisionModelFast,
} from "../client";
import { compositeFieldsOntoImage, cropAndCompositeQuadrant, type QuadrantBounds } from "../../image-compositor";
import { saveDebugImage, parseFieldReviewResponse } from "./shared";
import { buildFieldReviewPrompt } from "../prompts";
import type { ExtractedField, NormalizedCoordinates, FieldType, ChoiceOption } from "../../types";
import type { FieldReviewResult } from "./types";

interface ReviewFieldsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  fields: ExtractedField[];
}

interface ReviewQuadrantParams extends ReviewFieldsParams {
  quadrantBounds: QuadrantBounds;
  quadrantIndex: number;
}

export async function reviewFieldsWithVision(
  params: ReviewFieldsParams
): Promise<FieldReviewResult> {
  const { documentId, pageNumber, pageImageBase64, fields } = params;
  const hasDocumentAIFields = fields.length > 0;

  const qcStartTime = Date.now();
  console.log(`[AutoForm] ⏱️ START: Field review page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    mode: hasDocumentAIFields ? "QC" : "full-detection",
  });

  try {
    const compositeStart = Date.now();
    const composited = await compositeFieldsOntoImage({
      imageBase64: pageImageBase64,
      fields,
      showGrid: true,
      gridSpacing: 10,
    });
    const compositeTime = Date.now() - compositeStart;

    console.log(`[AutoForm] ⏱️ Composite image created (${compositeTime}ms):`, {
      documentId,
      pageNumber,
      dimensions: `${composited.width}x${composited.height}`,
    });

    await saveDebugImage(composited.imageBase64, `page${pageNumber}_full_qc.png`);

    const model = getVisionModelFast();
    const prompt = buildFieldReviewPrompt(pageNumber, fields, hasDocumentAIFields);

    const imagePart = {
      inlineData: {
        data: composited.imageBase64,
        mimeType: "image/png",
      },
    };

    console.log(`[AutoForm] ⏱️ Calling Gemini Vision for field review...`);
    const geminiStart = Date.now();
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();
    const geminiTime = Date.now() - geminiStart;

    const totalTime = Date.now() - qcStartTime;
    console.log(`[AutoForm] ⏱️ Gemini Vision field review response (${geminiTime}ms, total ${totalTime}ms):`, {
      documentId,
      pageNumber,
      responseLength: text.length,
    });

    console.log(`[AutoForm] Gemini QC raw response (page ${pageNumber}):\n${text}`);

    return parseFieldReviewResponse(text);
  } catch (error) {
    console.error(`[AutoForm] Field review failed for page ${pageNumber}:`, {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
    };
  }
}

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
    const composited = await cropAndCompositeQuadrant({
      imageBase64: pageImageBase64,
      fields: [],
      bounds: quadrantBounds,
      showGrid: true,
      gridSpacing: 10,
    });

    const cropDuration = Date.now() - startTime;

    await saveDebugImage(composited.imageBase64, `page${pageNumber}_cluster${quadrantIndex}.png`);

    const model = getVisionModelFast();
    const prompt = buildFieldReviewPrompt(pageNumber, fields, fields.length > 0, true, true);

    const imagePart = {
      inlineData: {
        data: composited.imageBase64,
        mimeType: "image/png",
      },
    };

    const geminiStart = Date.now();
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();
    const geminiDuration = Date.now() - geminiStart;

    const totalDuration = Date.now() - startTime;

    console.log(`[AutoForm] ⏱️ Cluster ${quadrantIndex} QC complete (page ${pageNumber}):`, {
      durationMs: totalDuration,
      cropMs: cropDuration,
      geminiMs: geminiDuration,
      responseLength: text.length,
    });

    console.log(`[AutoForm] Gemini cluster ${quadrantIndex} raw response (page ${pageNumber}):\n${text}`);

    const parsed = parseFieldReviewResponse(text);
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

function mapQuadrantResultsToPage(
  result: FieldReviewResult,
  bounds: QuadrantBounds
): FieldReviewResult {
  const quadrantWidth = bounds.right - bounds.left;
  const quadrantHeight = bounds.bottom - bounds.top;

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

  const mappedNewFields = result.newFields.map((field) => ({
    ...field,
    coordinates: {
      left: bounds.left + (field.coordinates.left / 100) * quadrantWidth,
      top: bounds.top + (field.coordinates.top / 100) * quadrantHeight,
      width: (field.coordinates.width / 100) * quadrantWidth,
      height: (field.coordinates.height / 100) * quadrantHeight,
    },
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
