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
 * Includes table and linkedText as special field types:
 * - table: compact definition that expands to N×M text fields
 * - linkedText: multi-segment text area stored as single field
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
          // For table fields
          tableConfig: {
            type: "object",
            properties: {
              columnHeaders: {
                type: "array",
                items: { type: "string" },
              },
              coordinates: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
                required: ["left", "top", "width", "height"],
              },
              dataRows: { type: "number" },
              columnPositions: {
                type: "array",
                items: { type: "number" },
              },
              rowHeights: {
                type: "array",
                items: { type: "number" },
              },
            },
            required: ["columnHeaders", "coordinates", "dataRows"],
          },
          // For linkedText fields
          segments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                left: { type: "number" },
                top: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
              },
              required: ["left", "top", "width", "height"],
            },
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

  return { left, top, width, height };
}

/**
 * Parse the Gemini response for quadrant extraction
 */
function parseQuadrantExtractionResponse(
  text: string,
  quadrant: QuadrantNumber
): { fields: RawExtractedField[]; noFieldsInRegion: boolean } {
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
    for (const field of parsed.fields || []) {
      const rawCoords = field.coordinates;
      if (!rawCoords || typeof rawCoords.top !== "number") {
        console.warn("[AutoForm] Quadrant extraction: Field missing coordinates, skipping", {
          quadrant,
          label: field.label,
        });
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

  try {
    // Call Gemini Flash Vision with responseSchema to force correct structure
    const responseText = await generateWithVisionFast({
      prompt,
      imageParts: [imagePart],
      jsonOutput: true,
      responseSchema: fieldExtractionSchema,
    });

    const durationMs = Date.now() - startTime;

    // Debug: Log raw response
    console.log("[AutoForm] Quadrant raw response:", {
      quadrant,
      responseLength: responseText.length,
      responsePreview: responseText.slice(0, 500),
    });

    // Parse response
    const { fields, noFieldsInRegion } = parseQuadrantExtractionResponse(
      responseText,
      quadrant
    );

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
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("[AutoForm] Quadrant extraction failed:", {
      pageNumber,
      quadrant,
      error,
      durationMs,
    });

    return {
      quadrant,
      fields: [],
      noFieldsInRegion: true,
      durationMs,
    };
  }
}
