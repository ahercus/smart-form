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
 * Sometimes Gemini returns position values (top/left) that are ~10x the correct
 * percentage (e.g., top=200 instead of top=20) while dimensions (width/height)
 * remain correct. This detects the issue by checking if positions exceed the
 * valid 0-100 range and rescales only the affected components.
 */
function normalizeCoordinateScale(fields: RawExtractedField[]): RawExtractedField[] {
  if (fields.length === 0) return fields;

  // Collect all position and dimension values to detect which axis is off
  let maxTop = 0;
  let maxLeft = 0;
  let maxHeight = 0;
  let maxWidth = 0;

  for (const field of fields) {
    const { left, top, width, height } = field.coordinates;
    maxTop = Math.max(maxTop, top);
    maxLeft = Math.max(maxLeft, left);
    maxHeight = Math.max(maxHeight, height);
    maxWidth = Math.max(maxWidth, width);

    if (field.dateSegments) {
      for (const seg of field.dateSegments) {
        maxTop = Math.max(maxTop, seg.top);
        maxLeft = Math.max(maxLeft, seg.left);
      }
    }
    if (field.segments) {
      for (const seg of field.segments) {
        maxTop = Math.max(maxTop, seg.top);
        maxLeft = Math.max(maxLeft, seg.left);
      }
    }
    if (field.tableConfig?.coordinates) {
      const tc = field.tableConfig.coordinates;
      maxTop = Math.max(maxTop, tc.top);
      maxLeft = Math.max(maxLeft, tc.left);
    }
  }

  // Detect if positions are out of range (>110%) while dimensions are normal (<50%)
  // This pattern indicates Gemini used a different scale for position values
  const topOutOfRange = maxTop > 110;
  const leftOutOfRange = maxLeft > 110;

  if (!topOutOfRange && !leftOutOfRange) return fields;

  // Calculate scale factors from position values only
  // Use the max position + a reasonable dimension estimate to find the true page extent
  const yScale = topOutOfRange ? (maxTop + maxHeight) / 100 : 1;
  const xScale = leftOutOfRange ? (maxLeft + maxWidth) / 100 : 1;

  console.warn("[AutoForm] Coordinate scale correction:", {
    maxTop: maxTop.toFixed(1),
    maxLeft: maxLeft.toFixed(1),
    maxHeight: maxHeight.toFixed(1),
    maxWidth: maxWidth.toFixed(1),
    yScale: yScale.toFixed(2),
    xScale: xScale.toFixed(2),
    fieldCount: fields.length,
  });

  // Only rescale position components (top/left), leave dimensions (width/height) alone
  // unless dimensions are also out of range
  const scaleHeight = maxHeight > 50;
  const scaleWidth = maxWidth > 50;

  function rescaleCoords(coords: NormalizedCoordinates): NormalizedCoordinates {
    return {
      left: leftOutOfRange ? coords.left / xScale : coords.left,
      top: topOutOfRange ? coords.top / yScale : coords.top,
      width: scaleWidth ? coords.width / xScale : coords.width,
      height: scaleHeight ? coords.height / yScale : coords.height,
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
