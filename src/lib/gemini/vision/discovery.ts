import { getVisionModelFast, getVisionModel } from "../client";
import { saveDebugImage, parseFieldReviewResponse } from "./shared";
import { buildGlobalAuditPrompt } from "../prompts";
import type { FieldReviewResult } from "./types";

// Use Gemini Pro for Global Audit if set (better reasoning for noise detection)
// Default to Flash for speed
const USE_PRO_FOR_AUDIT = process.env.USE_PRO_FOR_GLOBAL_AUDIT === "true";

interface DiscoverFieldsParams {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  existingFieldIds: string[];
  existingFields?: Array<{ id: string; label: string; fieldType: string }>; // For better context
}

export async function discoverMissedFields(
  params: DiscoverFieldsParams
): Promise<FieldReviewResult & { durationMs: number }> {
  const { documentId, pageNumber, pageImageBase64, existingFieldIds, existingFields } = params;
  const startTime = Date.now();

  console.log(`[AutoForm] Global Audit start (page ${pageNumber}):`, {
    existingFieldCount: existingFieldIds.length,
    model: USE_PRO_FOR_AUDIT ? "Pro" : "Flash",
  });

  try {
    const model = USE_PRO_FOR_AUDIT ? getVisionModel() : getVisionModelFast();
    const prompt = buildGlobalAuditPrompt(pageNumber, existingFieldIds, existingFields);

    await saveDebugImage(pageImageBase64, `page${pageNumber}_discovery.png`);

    const imagePart = {
      inlineData: {
        data: pageImageBase64,
        mimeType: "image/png",
      },
    };

    const geminiStart = Date.now();
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();
    const geminiDuration = Date.now() - geminiStart;

    const totalDuration = Date.now() - startTime;

    const parsed = parseFieldReviewResponse(text);

    console.log(`[AutoForm] ⏱️ Global Audit complete (page ${pageNumber}):`, {
      durationMs: totalDuration,
      geminiMs: geminiDuration,
      responseLength: text.length,
      model: USE_PRO_FOR_AUDIT ? "Pro" : "Flash",
      newFieldsFound: parsed.newFields.length,
      fieldsToRemove: parsed.removeFields?.length || 0,
    });

    console.log(`[AutoForm] Gemini Global Audit raw response (page ${pageNumber}):\n${text}`);

    return {
      adjustments: [],
      newFields: parsed.newFields,
      removeFields: parsed.removeFields || [],
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
