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
import type { NormalizedCoordinates, DateSegment, ChoiceOption } from "../../types";

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
  choiceOptions?: ChoiceOption[];
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

    if (field.fieldType === "circle_choice" && (!field.choiceOptions || field.choiceOptions.length === 0)) {
      console.warn("[AutoForm] Skipping circle_choice field without choiceOptions:", field.label);
      return false;
    }

    return true;
  });

  // Detect and fix out-of-range coordinates (Gemini sometimes returns ~10x values)
  const normalizedFields = normalizeCoordinateScale(validFields);

  console.log("[AutoForm] Single-page extraction complete:", {
    totalFields: normalizedFields.length,
    invalidSkipped: parsed.fields.length - validFields.length,
    durationMs,
  });

  return {
    fields: normalizedFields,
    durationMs,
  };
}

/**
 * Detect if Gemini returned coordinates in wrong scale and normalize them.
 *
 * Gemini sometimes returns coordinates in a ~0-1000 pixel scale instead of
 * 0-100 percentages. We detect this by finding the max right/bottom extent
 * (left+width, top+height) across all fields. If either axis exceeds 105,
 * we uniformly rescale ALL coordinate components on that axis.
 */
function normalizeCoordinateScale(fields: RawExtractedField[]): RawExtractedField[] {
  if (fields.length === 0) return fields;

  // Find the actual page extent by computing max(pos + dim) per axis
  // This must use the SAME field's left+width (not max left + max width from different fields)
  let maxRight = 0;
  let maxBottom = 0;

  function trackCoords(coords: NormalizedCoordinates) {
    const right = coords.left + coords.width;
    const bottom = coords.top + coords.height;
    // Guard against NaN from malformed sub-coordinates (Gemini schema is loosely typed)
    if (Number.isFinite(right)) maxRight = Math.max(maxRight, right);
    if (Number.isFinite(bottom)) maxBottom = Math.max(maxBottom, bottom);
  }

  for (const field of fields) {
    trackCoords(field.coordinates);

    if (field.dateSegments) {
      for (const seg of field.dateSegments) trackCoords(seg);
    }
    if (field.segments) {
      for (const seg of field.segments) trackCoords(seg);
    }
    if (field.choiceOptions) {
      for (const opt of field.choiceOptions) trackCoords(opt.coordinates);
    }
    if (field.tableConfig?.coordinates) {
      trackCoords(field.tableConfig.coordinates);
    }
  }

  // If extents are within valid percentage range, no rescaling needed
  const xOutOfRange = maxRight > 105;
  const yOutOfRange = maxBottom > 105;

  if (!xOutOfRange && !yOutOfRange) return fields;

  // Scale factor = actual extent / 100, applied uniformly to ALL components on that axis
  const xScale = xOutOfRange ? maxRight / 100 : 1;
  const yScale = yOutOfRange ? maxBottom / 100 : 1;

  console.warn("[AutoForm] Coordinate scale correction:", {
    maxRight: maxRight.toFixed(1),
    maxBottom: maxBottom.toFixed(1),
    xScale: xScale.toFixed(2),
    yScale: yScale.toFixed(2),
    fieldCount: fields.length,
  });

  function rescaleCoords(coords: NormalizedCoordinates): NormalizedCoordinates {
    return {
      left: coords.left / xScale,
      top: coords.top / yScale,
      width: coords.width / xScale,
      height: coords.height / yScale,
    };
  }

  return fields.map((field) => ({
    ...field,
    coordinates: rescaleCoords(field.coordinates),
    dateSegments: field.dateSegments?.map((seg) => ({
      ...seg,
      ...rescaleCoords(seg),
    })),
    segments: field.segments?.map((seg) => rescaleCoords(seg)),
    choiceOptions: field.choiceOptions?.map((opt) => ({
      ...opt,
      coordinates: rescaleCoords(opt.coordinates),
    })),
    tableConfig: field.tableConfig
      ? {
          ...field.tableConfig,
          coordinates: field.tableConfig.coordinates
            ? rescaleCoords(field.tableConfig.coordinates)
            : field.tableConfig.coordinates,
        }
      : field.tableConfig,
  }));
}
