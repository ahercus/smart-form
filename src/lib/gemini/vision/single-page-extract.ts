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
import type { VectorLine } from "../../coordinate-snapping/types";

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

  // Log full Gemini response for debugging
  console.log("[AutoForm] Gemini extraction response:", responseText.slice(0, 3000));

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

/**
 * Normalize out-of-range Gemini coordinates using vector line calibration.
 *
 * Gemini Vision sometimes returns coordinates in a non-percentage scale
 * (commonly 0-1000), and often inconsistently — some fields on a page may
 * use 0-100 while others use 0-1000. This function handles both cases:
 *
 * 1. **Page-wide rescale**: If the majority of fields on an axis are out of
 *    range (>105), calibrate a scale factor against PDF vector lines.
 * 2. **Per-field outlier fix**: If only a few fields are out of range on an
 *    axis, individually fix those fields (divide by 10) without affecting
 *    the correctly-scaled majority.
 *
 * Each axis (X/Y) is handled independently — Gemini may use different scales
 * for horizontal vs vertical coordinates.
 *
 * Must be called AFTER vector geometry is available (from the orchestrator).
 */
export function normalizeCoordinateScale(
  fields: RawExtractedField[],
  vectorLines?: VectorLine[],
): RawExtractedField[] {
  if (fields.length === 0) return fields;

  // Count per-axis how many fields have out-of-range main coordinates
  let xOutCount = 0;
  let yOutCount = 0;
  let maxRight = 0;
  let maxBottom = 0;

  function trackExtent(coords: NormalizedCoordinates | undefined | null) {
    if (!coords || typeof coords.left !== "number" || typeof coords.width !== "number") return;
    const right = coords.left + coords.width;
    const bottom = coords.top + coords.height;
    if (Number.isFinite(right)) maxRight = Math.max(maxRight, right);
    if (Number.isFinite(bottom)) maxBottom = Math.max(maxBottom, bottom);
  }

  // Also track max size values (width/height) separately from positions (left/top)
  // Gemini often returns positions in 0-1000 but sizes in 0-100 within the same field
  let maxWidth = 0;
  let maxHeight = 0;

  for (const field of fields) {
    const c = field.coordinates;
    const right = c.left + c.width;
    const bottom = c.top + c.height;
    if (right > 105 || c.left > 105) xOutCount++;
    if (bottom > 105 || c.top > 105) yOutCount++;
    maxWidth = Math.max(maxWidth, c.width);
    maxHeight = Math.max(maxHeight, c.height);
    trackExtent(c);
    if (field.dateSegments) for (const seg of field.dateSegments) trackExtent(seg);
    if (field.segments) for (const seg of field.segments) trackExtent(seg);
    if (field.choiceOptions) for (const opt of field.choiceOptions) trackExtent(opt.coordinates);
    if (field.tableConfig?.coordinates) trackExtent(field.tableConfig.coordinates);
  }

  // Majority threshold: if >30% of fields are out of range, it's a page-wide scale issue.
  // Otherwise it's just a few outlier fields with wrong coordinates.
  const majorityThreshold = Math.max(2, fields.length * 0.3);
  const xPageRescale = xOutCount >= majorityThreshold && maxRight > 105;
  const yPageRescale = yOutCount >= majorityThreshold && maxBottom > 105;
  const xHasOutliers = xOutCount > 0 && !xPageRescale;
  const yHasOutliers = yOutCount > 0 && !yPageRescale;

  // Detect mixed-scale: positions (left/top) in 0-1000 but sizes (width/height) in 0-100.
  // If max size < 105 while positions are clearly out of range, only rescale positions.
  const xPositionOnly = xPageRescale && maxWidth <= 105;
  const yPositionOnly = yPageRescale && maxHeight <= 105;

  if (!xPageRescale && !yPageRescale && !xHasOutliers && !yHasOutliers) return fields;

  // Calibrate page-wide scales if needed
  let xScale = 1;
  let yScale = 1;
  if (xPageRescale || yPageRescale) {
    const calibrated = calibrateScale(
      fields, maxRight, maxBottom, xPageRescale, yPageRescale, vectorLines,
    );
    xScale = calibrated.xScale;
    yScale = calibrated.yScale;
  }

  console.warn("[AutoForm] Coordinate scale correction:", {
    xOutCount, yOutCount, totalFields: fields.length,
    maxRight: maxRight.toFixed(1), maxBottom: maxBottom.toFixed(1),
    maxWidth: maxWidth.toFixed(1), maxHeight: maxHeight.toFixed(1),
    xPageRescale, yPageRescale, xPositionOnly, yPositionOnly,
    xHasOutliers, yHasOutliers,
    xScale: xScale.toFixed(2), yScale: yScale.toFixed(2),
    method: (xPageRescale || yPageRescale)
      ? (vectorLines && vectorLines.length > 0 ? "vector-calibrated" : "fallback")
      : "outlier-only",
  });

  /**
   * Normalize a single coordinate set.
   *
   * Gemini may mix scales within a single field — e.g., top in 0-1000 but
   * height in 0-100. When "positionOnly" is detected (positions out of range
   * but sizes all ≤ 105), only left/top get divided by the scale.
   *
   * For outlier axes (minority of fields out of range), only individual
   * VALUES > 105 get divided by 10.
   */
  function normalizeCoords(coords: NormalizedCoordinates): NormalizedCoordinates {
    let { left, top, width, height } = coords;

    // X axis
    if (xPageRescale) {
      left /= xScale;
      if (!xPositionOnly) width /= xScale;
      else if (width > 105) width /= xScale; // size is also out of range for this field
    } else if (xHasOutliers) {
      if (left > 105) left /= 10;
      if (width > 105) width /= 10;
    }

    // Y axis
    if (yPageRescale) {
      top /= yScale;
      if (!yPositionOnly) height /= yScale;
      else if (height > 105) height /= yScale; // size is also out of range for this field
    } else if (yHasOutliers) {
      if (top > 105) top /= 10;
      if (height > 105) height /= 10;
    }

    return { left, top, width, height };
  }

  return fields.map((field) => ({
    ...field,
    coordinates: normalizeCoords(field.coordinates),
    dateSegments: field.dateSegments?.map((seg) => ({
      ...seg,
      ...normalizeCoords(seg),
    })),
    segments: field.segments?.map((seg) => normalizeCoords(seg)),
    choiceOptions: field.choiceOptions?.map((opt) => ({
      ...opt,
      coordinates: opt.coordinates && typeof opt.coordinates === "object" && "left" in opt.coordinates
        ? normalizeCoords(opt.coordinates)
        : opt.coordinates,
    })),
    tableConfig: field.tableConfig
      ? {
          ...field.tableConfig,
          coordinates: field.tableConfig.coordinates
            ? normalizeCoords(field.tableConfig.coordinates)
            : field.tableConfig.coordinates,
          // columnPositions are usually relative (0-100 within table).
          // Only rescale if values themselves are out of range (>105).
          columnPositions: field.tableConfig.columnPositions &&
            field.tableConfig.columnPositions.some((p: number) => p > 105)
            ? field.tableConfig.columnPositions.map((p: number) => p / (xPageRescale ? xScale : 10))
            : field.tableConfig.columnPositions,
          rowHeights: field.tableConfig.rowHeights &&
            field.tableConfig.rowHeights.some((h: number) => h > 105)
            ? field.tableConfig.rowHeights.map((h: number) => h / (yPageRescale ? yScale : 10))
            : field.tableConfig.rowHeights,
        }
      : field.tableConfig,
  }));
}

/**
 * Determine the optimal coordinate scale by testing candidate scales
 * against PDF vector lines (ground truth).
 *
 * For each candidate scale, normalizes field coordinates and counts how many
 * text/date field bottom edges align with horizontal PDF vector lines.
 * The scale with the most alignments wins.
 */
function calibrateScale(
  fields: RawExtractedField[],
  maxRight: number,
  maxBottom: number,
  xOutOfRange: boolean,
  yOutOfRange: boolean,
  vectorLines?: VectorLine[],
): { xScale: number; yScale: number } {
  // Horizontal vector lines with significant length — our ground truth
  const hLines = vectorLines?.filter(
    (l) => l.isHorizontal && Math.abs(l.x2 - l.x1) > 5,
  ) || [];

  // Text/date/textarea fields for calibration (their bottom edges should sit on lines)
  const calibrationFields = fields.filter((f) =>
    ["text", "date", "textarea"].includes(f.fieldType),
  );

  // No ground truth or no suitable fields → fall back to 0-1000 system (most common)
  if (hLines.length === 0 || calibrationFields.length === 0) {
    return {
      xScale: xOutOfRange ? 10 : 1,
      yScale: yOutOfRange ? 10 : 1,
    };
  }

  // Generate candidate scales from the data
  const maxExtent = Math.max(maxRight, maxBottom);
  const candidateSet = new Set<number>();
  candidateSet.add(10);                                      // 0-1000 system
  candidateSet.add(Number((maxExtent / 100).toFixed(2)));    // extent-based
  candidateSet.add(Math.ceil(maxExtent / 100));              // rounded up
  candidateSet.add(Math.round(maxExtent / 100));             // rounded
  if (xOutOfRange) candidateSet.add(Number((maxRight / 100).toFixed(2)));
  if (yOutOfRange) candidateSet.add(Number((maxBottom / 100).toFixed(2)));

  const candidates = [...candidateSet].filter((c) => c >= 2 && c <= 30);

  let bestScale = 10;
  let bestAlignments = -1;

  for (const scale of candidates) {
    let alignments = 0;
    const yS = yOutOfRange ? scale : 1;
    const xS = xOutOfRange ? scale : 1;

    for (const field of calibrationFields) {
      const bottom = (field.coordinates.top + field.coordinates.height) / yS;
      const left = field.coordinates.left / xS;
      const right = (field.coordinates.left + field.coordinates.width) / xS;

      for (const line of hLines) {
        // Bottom edge within 2% of a horizontal line
        if (Math.abs(line.y1 - bottom) < 2.0) {
          // Require horizontal overlap (at least 30% of field width)
          const fieldWidth = right - left;
          if (fieldWidth <= 0) continue;
          const overlapLeft = Math.max(left, line.x1);
          const overlapRight = Math.min(right, line.x2);
          if (overlapRight - overlapLeft > fieldWidth * 0.3) {
            alignments++;
            break;
          }
        }
      }
    }

    if (alignments > bestAlignments) {
      bestAlignments = alignments;
      bestScale = scale;
    }
  }

  console.log("[AutoForm] Scale calibration:", {
    candidates: candidates.map((c) => c.toFixed(2)),
    bestScale: bestScale.toFixed(2),
    alignments: bestAlignments,
    totalCalibrationFields: calibrationFields.length,
  });

  return {
    xScale: xOutOfRange ? bestScale : 1,
    yScale: yOutOfRange ? bestScale : 1,
  };
}
