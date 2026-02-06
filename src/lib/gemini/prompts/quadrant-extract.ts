import type { QuadrantNumber } from "../../image-compositor";

/**
 * Build prompt for quadrant-based field extraction
 * Each quadrant agent sees the full page but only extracts fields within their purple-highlighted region
 */
export function buildQuadrantExtractionPrompt(
  pageNumber: number,
  quadrant: QuadrantNumber
): string {
  const quadrantRanges: Record<QuadrantNumber, { top: number; bottom: number }> = {
    1: { top: 0, bottom: 25 },
    2: { top: 25, bottom: 50 },
    3: { top: 50, bottom: 75 },
    4: { top: 75, bottom: 100 },
  };

  const range = quadrantRanges[quadrant];

  // Boundary rules - only relevant for middle quadrants
  const boundaryRules =
    quadrant === 1
      ? `If a field crosses the BOTTOM of the purple box (${range.bottom}%), include it fully.`
      : quadrant === 4
        ? `If a field crosses the TOP of the purple box (${range.top}%), skip it.`
        : `If a field crosses the TOP of the purple box (${range.top}%), skip it. If it crosses the BOTTOM (${range.bottom}%), include it fully.`;

  return `Extract ALL fillable input fields within the PURPLE HIGHLIGHTED REGION (${range.top}%-${range.bottom}% vertically).

GUIDING PRINCIPLE: Imagine someone filling this form digitally. Place input boxes where they'd intuitively expect to write. Use common sense.

COORDINATES ARE PERCENTAGES (0-100) - use the ruler in the margins.

EVERY FIELD MUST HAVE coordinates - NO EXCEPTIONS!
{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": { "left": 20, "top": 8, "width": 30, "height": 2.5 }  ← REQUIRED!
}

RULES:
1. COORDINATES REQUIRED: Every field MUST have left, top, width, height as percentages (0-100)
2. EXCLUDE LABELS: Box = ONLY the empty input area, NOT the label text
3. FULL WIDTH: Underlines spanning the page should have width ≈ 85-90%
4. CHECKBOXES: Small square only (width/height ≈ 2-3%)
5. EXTRACT EVERYTHING: Include text fields, dates, checkboxes, signatures - not just tables!

SPECIAL TOOL - TABLE (for grids with columns):
{
  "fieldType": "table",
  "label": "Siblings",
  "tableConfig": {
    "columnHeaders": ["Name", "Age", "Teacher", "Comments"],
    "coordinates": { "left": 5, "top": 30, "width": 90, "height": 15 },
    "dataRows": 4,
    "columnPositions": [0, 20, 35, 60, 100]
  }
}
- tableConfig is REQUIRED for tables
- dataRows = number of BLANK rows to fill (NOT counting the header row with column labels)
- columnPositions = boundaries as % of table width (0=left edge, 100=right edge). Look at actual column widths!
  Example: 4 columns where first is 20%, second is 15%, third is 25%, fourth is 40% → [0, 20, 35, 60, 100]
  If columns look roughly equal, omit columnPositions for uniform distribution

SPECIAL TOOL - LINKED TEXT (for multi-line flowing text):
{
  "fieldType": "linkedText",
  "label": "Details",
  "segments": [
    { "left": 15, "top": 30, "width": 80, "height": 2 },
    { "left": 5, "top": 33, "width": 90, "height": 2 }
  ]
}
- segments is REQUIRED for linkedText

${boundaryRules}

Field types: text, date, checkbox, radio, signature, initials, circle_choice, table, linkedText

Return JSON - EVERY field needs coordinates:
{
  "fields": [
    { "label": "...", "fieldType": "text", "coordinates": { "left": X, "top": Y, "width": W, "height": H } }
  ],
  "noFieldsInRegion": false
}`;
}

/**
 * Schema for quadrant extraction responses
 */
export const quadrantExtractionSchema = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Label for the field" },
          fieldType: {
            type: "string",
            enum: [
              "text",
              "textarea",
              "checkbox",
              "radio",
              "date",
              "signature",
              "initials",
              "circle_choice",
              "table",
              "linkedText",
            ],
            description: "Field type",
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
          choiceOptions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                coordinates: {
                  type: "object",
                  properties: {
                    left: { type: "number" },
                    top: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                  },
                },
              },
            },
            description: "Choice options for circle_choice fields",
          },
          tableConfig: {
            type: "object",
            properties: {
              columnHeaders: {
                type: "array",
                items: { type: "string" },
                description: "Header labels for each column",
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
              dataRows: {
                type: "number",
                description: "Number of fillable data rows (excluding header)",
              },
              columnPositions: {
                type: "array",
                items: { type: "number" },
                description: "Optional column boundary positions as % within table (0=left, 100=right). Defaults to uniform.",
              },
              rowHeights: {
                type: "array",
                items: { type: "number" },
                description: "Optional row heights as % within table. Defaults to uniform.",
              },
            },
            required: ["columnHeaders", "coordinates", "dataRows"],
            description: "Configuration for table fields",
          },
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
            description: "Segments for linkedText fields - multiple rectangles that form a single flowing text input",
          },
        },
        required: ["label", "fieldType"],
      },
    },
    noFieldsInRegion: {
      type: "boolean",
      description: "True if no fillable fields were found in this quadrant",
    },
  },
  required: ["fields", "noFieldsInRegion"],
};
