/**
 * Quadrant-based field extraction using Gemini Vision
 *
 * Each quadrant agent sees the full page with a purple overlay highlighting
 * their assigned region. The agent extracts fields ONLY within that region,
 * following boundary ownership rules to prevent duplicates.
 */

import { generateWithVisionFast } from "../client";

/**
 * Flat response schema to force correct output structure
 * Uses lowercase type strings for JSON Schema compatibility
 *
 * NOTE: tableConfig and segments are NOT in the schema due to Gemini's nesting depth limit.
 * They will be parsed from the response in parseQuadrantExtractionResponse.
 */
const fieldExtractionSchema = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          fieldType: {
            type: "string",
            enum: [
              "text",
              "textarea",
              "date",
              "checkbox",
              "radio",
              "signature",
              "initials",
              "circle_choice",
              "table",
              "linkedText",
            ],
          },
          coordinates: {
            type: "object",
            properties: {
              left: { type: "number", description: "Percentage 0-100" },
              top: { type: "number", description: "Percentage 0-100" },
              width: { type: "number", description: "Percentage 0-100" },
              height: { type: "number", description: "Percentage 0-100" },
            },
            required: ["left", "top", "width", "height"],
          },
        },
        required: ["label", "fieldType"],
      },
    },
    noFieldsInRegion: { type: "boolean" },
  },
  required: ["fields", "noFieldsInRegion"],
};
import { buildQuadrantExtractionPrompt } from "../prompts/quadrant-extract";
import type { QuadrantNumber } from "../../image-compositor";
import type { NormalizedCoordinates } from "../../types";

/**
 * Table configuration for compact table definitions
 */
export interface TableConfig {
  columnHeaders: string[];
  coordinates: NormalizedCoordinates;
  dataRows: number;
  columnPositions?: number[]; // Optional - defaults to uniform
  rowHeights?: number[]; // Optional - defaults to uniform
}

/**
 * Raw field extracted from a quadrant (before ID generation)
 */
export interface RawExtractedField {
  label: string;
  fieldType: string;
  coordinates: NormalizedCoordinates;
  choiceOptions?: Array<{
    label: string;
    coordinates?: NormalizedCoordinates;
  }>;
  // For table fields - compact definition that expands to N×M text fields
  tableConfig?: TableConfig;
  // For linkedText fields - multiple segments that form a single flowing text input
  segments?: NormalizedCoordinates[];
}

/**
 * Result from extracting fields from a single quadrant
 */
export interface QuadrantExtractionResult {
  quadrant: QuadrantNumber;
  fields: RawExtractedField[];
  noFieldsInRegion: boolean;
  durationMs: number;
}

/**
 * Validate that a field has proper coordinates
 * - Regular fields: must have coordinates (nested or flat)
 * - Table fields: must have tableConfig.coordinates
 * - LinkedText fields: must have segments with coordinates
 *
 * Model sometimes returns flat coords (field.top) instead of nested (field.coordinates.top)
 */
function validateFieldCoordinates(field: {
  label?: string;
  fieldType?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  coordinates?: { left?: number; top?: number; width?: number; height?: number };
  tableConfig?: { coordinates?: { left?: number; top?: number; width?: number; height?: number } };
  segments?: Array<{ left?: number; top?: number; width?: number; height?: number }>;
}): { valid: boolean; reason?: string } {
  const { fieldType, coordinates, tableConfig, segments } = field;

  if (fieldType === "table") {
    // Tables need tableConfig.coordinates
    if (!tableConfig?.coordinates || typeof tableConfig.coordinates.top !== "number") {
      return { valid: false, reason: "table missing tableConfig.coordinates" };
    }
    return { valid: true };
  }

  if (fieldType === "linkedText") {
    // LinkedText needs segments with coordinates
    if (!segments || segments.length === 0) {
      return { valid: false, reason: "linkedText missing segments" };
    }
    if (typeof segments[0].top !== "number") {
      return { valid: false, reason: "linkedText segment missing coordinates" };
    }
    return { valid: true };
  }

  // Regular fields need coordinates - check nested OR flat
  const hasNestedCoords = coordinates && typeof coordinates.top === "number";
  const hasFlatCoords = typeof field.top === "number";

  if (!hasNestedCoords && !hasFlatCoords) {
    return { valid: false, reason: "missing coordinates" };
  }

  return { valid: true };
}

/**
 * Detect if coordinates are in pixels and convert to percentages
 * Handles mixed coordinate systems (model sometimes mixes pixels and percentages)
 * Images are resized to max 1600px width, with ~2000px height for letter aspect ratio
 */
function normalizeCoordinates(
  coords: { left: number; top: number; width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const estimatedWidth = 1600;
  const estimatedHeight = 2000;

  let left = coords.left;
  let top = coords.top;
  let width = coords.width;
  let height = coords.height;

  // Handle horizontal axis (left/width) - if left > 100, it's pixels
  if (left > 100) {
    console.log("[AutoForm] Converting horizontal pixel coords:", { left, width });
    left = (left / estimatedWidth) * 100;
    width = (width / estimatedWidth) * 100;
  }

  // Handle vertical axis (top/height) - if top > 100, it's pixels
  if (top > 100) {
    console.log("[AutoForm] Converting vertical pixel coords:", { top, height });
    top = (top / estimatedHeight) * 100;
    height = (height / estimatedHeight) * 100;
  }

  // Clamp values to valid percentage range (0-100)
  // Also ensure field doesn't extend beyond page boundaries
  left = Math.max(0, Math.min(100, left));
  top = Math.max(0, Math.min(100, top));
  width = Math.max(0.5, Math.min(100 - left, width)); // At least 0.5% wide, max to page edge
  height = Math.max(0.5, Math.min(100 - top, height)); // At least 0.5% tall, max to page edge

  return { left, top, width, height };
}

/**
 * Parse the Gemini response for quadrant extraction
 * Returns fields, noFieldsInRegion flag, and count of invalid fields (for retry logic)
 */
function parseQuadrantExtractionResponse(
  text: string,
  quadrant: QuadrantNumber
): { fields: RawExtractedField[]; noFieldsInRegion: boolean; invalidCount: number } {
  // Clean up markdown code blocks if present
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

    // Validate and filter fields to ensure they're in the correct quadrant range
    const quadrantRanges: Record<QuadrantNumber, { top: number; bottom: number }> = {
      1: { top: 0, bottom: 25 },
      2: { top: 25, bottom: 50 },
      3: { top: 50, bottom: 75 },
      4: { top: 75, bottom: 100 },
    };
    const range = quadrantRanges[quadrant];

    const validFields: RawExtractedField[] = [];
    let invalidCount = 0;

    for (const field of parsed.fields || []) {
      // Validate field has proper coordinates based on type
      const validation = validateFieldCoordinates(field);
      if (!validation.valid) {
        console.warn("[AutoForm] Quadrant extraction: Invalid field, skipping", {
          quadrant,
          label: field.label,
          fieldType: field.fieldType,
          reason: validation.reason,
        });
        invalidCount++;
        continue;
      }

      // For table fields, coordinates are inside tableConfig
      // For linkedText fields, use first segment
      // For regular fields, check nested coordinates OR flat coordinates at field level
      let rawCoords: { left: number; top: number; width: number; height: number } | undefined;

      if (field.fieldType === "table" && field.tableConfig?.coordinates) {
        rawCoords = field.tableConfig.coordinates;
      } else if (field.fieldType === "linkedText" && field.segments?.length > 0) {
        rawCoords = field.segments[0]; // Use first segment for bounds checking
      } else if (field.coordinates && typeof field.coordinates.top === "number") {
        rawCoords = field.coordinates; // Nested coordinates
      } else if (typeof field.left === "number" && typeof field.top === "number") {
        // Flat coordinates at field level - convert to nested structure
        rawCoords = {
          left: field.left,
          top: field.top,
          width: field.width || 10,
          height: field.height || 3,
        };
      }

      // Safety check - validation should have caught this but guard anyway
      if (!rawCoords) {
        console.warn("[AutoForm] Quadrant extraction: No coordinates found after validation", {
          quadrant,
          label: field.label,
        });
        invalidCount++;
        continue;
      }

      // Normalize coordinates (convert pixels to percentages if needed)
      const coords = normalizeCoordinates(rawCoords);

      // Check if field is within quadrant bounds (with small tolerance for boundary fields)
      const fieldTop = coords.top;
      const fieldBottom = coords.top + (coords.height || 0);
      const tolerance = 2; // 2% tolerance for boundary cases

      // Field must have at least part of its body within the quadrant
      const inRegion =
        (fieldTop >= range.top - tolerance && fieldTop < range.bottom + tolerance) ||
        (fieldBottom > range.top - tolerance && fieldBottom <= range.bottom + tolerance);

      if (!inRegion) {
        console.warn("[AutoForm] Quadrant extraction: Field outside quadrant bounds, skipping", {
          quadrant,
          range,
          label: field.label,
          top: fieldTop,
          bottom: fieldBottom,
        });
        continue;
      }

      // Build the raw field with all properties
      const rawField: RawExtractedField = {
        label: field.label || "Unknown",
        fieldType: field.fieldType || "text",
        coordinates: {
          left: coords.left || 0,
          top: coords.top || 0,
          width: coords.width || 10,
          height: coords.height || 4,
        },
        choiceOptions: field.choiceOptions,
      };

      // For table fields, include the tableConfig
      if (field.fieldType === "table" && field.tableConfig) {
        rawField.tableConfig = {
          columnHeaders: field.tableConfig.columnHeaders || [],
          coordinates: normalizeCoordinates(field.tableConfig.coordinates || coords),
          dataRows: field.tableConfig.dataRows || 1,
          columnPositions: field.tableConfig.columnPositions,
          rowHeights: field.tableConfig.rowHeights,
        };
      }

      // For linkedText fields, include the segments
      if (field.fieldType === "linkedText" && field.segments) {
        rawField.segments = field.segments.map((seg: NormalizedCoordinates) =>
          normalizeCoordinates(seg)
        );
      }

      validFields.push(rawField);
    }

    return {
      fields: validFields,
      noFieldsInRegion: parsed.noFieldsInRegion || validFields.length === 0,
      invalidCount,
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse quadrant extraction response:", {
      error,
      quadrant,
      text: cleaned.slice(0, 500),
    });
    return {
      fields: [],
      noFieldsInRegion: true,
      invalidCount: 0,
    };
  }
}

/**
 * Extract fields from a single quadrant of a page
 *
 * @param pageImageBase64 - Full page image with quadrant overlay already applied
 * @param quadrant - Which quadrant (1-4)
 * @param pageNumber - Page number for logging
 */
export async function extractQuadrantFields(options: {
  pageImageBase64: string;
  quadrant: QuadrantNumber;
  pageNumber: number;
}): Promise<QuadrantExtractionResult> {
  const { pageImageBase64, quadrant, pageNumber } = options;
  const startTime = Date.now();

  console.log("[AutoForm] Extracting fields from quadrant:", {
    pageNumber,
    quadrant,
  });

  // Build prompt for this quadrant
  const prompt = buildQuadrantExtractionPrompt(pageNumber, quadrant);

  // Prepare image part
  const imagePart = {
    inlineData: {
      data: pageImageBase64,
      mimeType: "image/png",
    },
  };

  const MAX_RETRIES = 1;
  let bestResult: { fields: RawExtractedField[]; noFieldsInRegion: boolean; invalidCount: number } | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Call Gemini Flash Vision WITH responseSchema to enforce basic structure
      // tableConfig/segments are NOT in schema (nesting depth limit) but model returns them from prompt
      const responseText = await generateWithVisionFast({
        prompt,
        imageParts: [imagePart],
        jsonOutput: true,
        responseSchema: fieldExtractionSchema,
      });

      // Debug: Log raw response
      console.log("[AutoForm] Quadrant raw response:", {
        quadrant,
        attempt,
        responseLength: responseText.length,
        responsePreview: responseText.slice(0, 500),
      });

      // Parse and validate response
      const result = parseQuadrantExtractionResponse(responseText, quadrant);

      console.log("[AutoForm] Quadrant parse result:", {
        pageNumber,
        quadrant,
        attempt,
        fieldsFound: result.fields.length,
        invalidCount: result.invalidCount,
      });

      // Keep best result (most valid fields)
      if (!bestResult || result.fields.length > bestResult.fields.length) {
        bestResult = result;
      }

      // If no invalid fields or this is our last attempt, use this result
      if (result.invalidCount === 0 || attempt === MAX_RETRIES) {
        break;
      }

      // Too many invalid fields - retry
      console.log("[AutoForm] Retrying quadrant extraction due to invalid fields:", {
        quadrant,
        invalidCount: result.invalidCount,
        validCount: result.fields.length,
      });
    } catch (error) {
      console.error("[AutoForm] Quadrant extraction attempt failed:", {
        pageNumber,
        quadrant,
        attempt,
        error,
      });
      // Continue to next attempt or fall through to return empty
    }
  }

  const durationMs = Date.now() - startTime;
  const { fields, noFieldsInRegion } = bestResult || { fields: [], noFieldsInRegion: true };

  console.log("[AutoForm] Quadrant extraction complete:", {
    pageNumber,
    quadrant,
    fieldsFound: fields.length,
    noFieldsInRegion,
    durationMs,
  });

  return {
    quadrant,
    fields,
    noFieldsInRegion,
    durationMs,
  };
}
