/**
 * Single-page field extraction using Gemini Vision
 *
 * Optimized configuration from 74 benchmark tests:
 * - Model: gemini-3-flash-preview
 * - Thinking: minimal
 * - Architecture: single_page (no rulers, no quadrants)
 * - Prompt: full_rails_no_rulers
 *
 * Results: 94% detection, 69% IoU
 */

import { ThinkingLevel } from "@google/genai";
import { generateWithVisionFast } from "../client";
import {
  buildSinglePageExtractionPrompt,
  SINGLE_PAGE_EXTRACTION_SCHEMA,
} from "../prompts/single-page-extract";
import type { NormalizedCoordinates, DateSegment } from "../../types";

// Raw field structure from Gemini extraction
export interface RawExtractedField {
  label: string;
  fieldType: string;
  coordinates: NormalizedCoordinates;
  groupLabel?: string | null;
  rows?: number;
  tableConfig?: {
    columnHeaders: string[];
    coordinates: NormalizedCoordinates;
    dataRows: number;
    columnPositions?: number[];
    rowHeights?: number[];
  };
  dateSegments?: DateSegment[];
  segments?: NormalizedCoordinates[];
}

export interface SinglePageExtractionResult {
  fields: RawExtractedField[];
  durationMs: number;
}

/**
 * Extract fields from a single page image
 *
 * @param imageBase64 - Base64 encoded page image (should be resized to ~1600px width)
 * @returns Extracted fields with coordinates
 */
export async function extractFieldsFromPage(
  imageBase64: string
): Promise<SinglePageExtractionResult> {
  const prompt = buildSinglePageExtractionPrompt();

  const startTime = Date.now();

  const responseText = await generateWithVisionFast({
    prompt,
    imageParts: [
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      },
    ],
    thinkingLevel: ThinkingLevel.MINIMAL,
    jsonOutput: true,
    responseSchema: SINGLE_PAGE_EXTRACTION_SCHEMA,
  });

  const durationMs = Date.now() - startTime;

  // Parse response
  let parsed: { fields: RawExtractedField[] };
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    console.error("[AutoForm] Failed to parse extraction response:", error);
    console.error("[AutoForm] Raw response:", responseText.slice(0, 500));
    throw new Error("Failed to parse Gemini extraction response");
  }

  // Validate fields
  const validFields = parsed.fields.filter((field) => {
    // Must have label and coordinates
    if (!field.label || !field.coordinates) {
      console.warn("[AutoForm] Skipping field missing label or coordinates:", field);
      return false;
    }

    // Validate coordinates are numbers
    const { left, top, width, height } = field.coordinates;
    if (
      typeof left !== "number" ||
      typeof top !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      console.warn("[AutoForm] Skipping field with invalid coordinates:", field);
      return false;
    }

    // Validate special field types have required data
    if (field.fieldType === "table" && !field.tableConfig) {
      console.warn("[AutoForm] Skipping table field without tableConfig:", field.label);
      return false;
    }

    if (field.fieldType === "linkedDate" && (!field.dateSegments || field.dateSegments.length === 0)) {
      console.warn("[AutoForm] Skipping linkedDate field without dateSegments:", field.label);
      return false;
    }

    if (field.fieldType === "linkedText" && (!field.segments || field.segments.length === 0)) {
      console.warn("[AutoForm] Skipping linkedText field without segments:", field.label);
      return false;
    }

    return true;
  });

  console.log("[AutoForm] Single-page extraction complete:", {
    totalFields: validFields.length,
    invalidSkipped: parsed.fields.length - validFields.length,
    durationMs,
  });

  return {
    fields: validFields,
    durationMs,
  };
}
