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
6. GROUP CONTEXT: For ANY field with a question/header above it, include "groupLabel" with that text

FIELD SIZING - MAXIMIZE INPUT AREA:
- Text fields: height 2.5-4% depending on visible underline/box - make as tall as the space allows
- Checkboxes/radio: 2-2.5% (small squares only)
- Signatures: 5-8% height, 25-40% width
- CONSISTENCY: If multiple fields look similar (same style underline, same box height), give them IDENTICAL dimensions

groupLabel - REQUIRED when context is needed:
{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": {...},
  "groupLabel": "Child's Details"
}
{
  "label": "Kindergarten",
  "fieldType": "checkbox",
  "coordinates": {...},
  "groupLabel": "What Pre-Prep experiences has your child had?"
}
- groupLabel captures the question/header/section that the field belongs to
- Include for ANY field where the label alone doesn't explain what info is needed

MULTI-LINE TEXT AREAS:
- For rectangular multi-line text boxes, use "textarea" with normal coordinates
- CRITICAL: Include "rows" property = count of visible horizontal lines in the textarea box
- The rows value helps render the field correctly (text aligns to lines)
- For irregular/non-rectangular flowing text (rare), use linkedText with segments

Example textarea:
{
  "label": "How will child settle into Prep?",
  "fieldType": "textarea",
  "coordinates": { "left": 6, "top": 68, "width": 88, "height": 7 },
  "rows": 4
}

SPECIAL TOOL - TABLE (ONLY for structured grids with column headers):
⚠️ DO NOT use table for simple lists or single-column areas - use textarea instead!
⚠️ TABLE FIELDS WITHOUT tableConfig WILL BE REJECTED!
{
  "fieldType": "table",
  "label": "Siblings",
  "tableConfig": {
    "columnHeaders": ["Name", "Age", "Teacher", "Comments"],
    "coordinates": { "left": 5, "top": 30, "width": 90, "height": 15 },
    "dataRows": 4
  }
}
- ONLY use table when there are VISIBLE column headers AND multiple data rows
- tableConfig with columnHeaders, coordinates, and dataRows is MANDATORY
- dataRows = number of BLANK rows (NOT counting the header row)
- columnPositions = optional, for non-uniform column widths as % boundaries [0, 20, 35, 60, 100]

SPECIAL TOOL - LINKED TEXT (ONLY for irregular flowing text):
⚠️ DO NOT use linkedText for simple multi-line boxes - use textarea instead!
⚠️ LINKEDTEXT FIELDS WITHOUT segments WILL BE REJECTED!
{
  "fieldType": "linkedText",
  "label": "Details",
  "segments": [
    { "left": 15, "top": 30, "width": 80, "height": 2 },
    { "left": 5, "top": 33, "width": 90, "height": 2 }
  ]
}
- ONLY use linkedText when text flows across MULTIPLE NON-ALIGNED lines (like text that wraps around an image)
- segments array is REQUIRED - each segment is a separate line/region
- For simple rectangular multi-line areas, use textarea with normal coordinates instead

SPECIAL TOOL - LINKED DATE (for segmented date fields like __ / __ / ____):
⚠️ DO NOT use linkedDate for simple date fields - use date instead!
⚠️ LINKEDDATE FIELDS WITHOUT dateSegments WILL BE REJECTED!
{
  "fieldType": "linkedDate",
  "label": "D.O.B",
  "dateSegments": [
    { "left": 45, "top": 12, "width": 4, "height": 2.5, "part": "day" },
    { "left": 52, "top": 12, "width": 4, "height": 2.5, "part": "month" },
    { "left": 59, "top": 12, "width": 6, "height": 2.5, "part": "year" }
  ]
}
- Use when date has SEPARATE BOXES for day, month, year (e.g., "__ / __ / ____")
- Each segment needs coordinates AND a "part": "day", "month", "year", or "year2"
- "year" = 4 digits (2026), "year2" = 2 digits (26)
- For simple single-box date fields, use "date" with normal coordinates instead

${boundaryRules}

Field types: text, textarea, date, checkbox, radio, signature, initials, circle_choice, table, linkedText, linkedDate
- text = single-line input
- textarea = multi-line rectangular box (PREFER THIS over linkedText!)

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
              "linkedDate",
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
          dateSegments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                left: { type: "number" },
                top: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                part: {
                  type: "string",
                  enum: ["day", "month", "year", "year2"],
                  description: "Which part of the date this segment represents",
                },
              },
              required: ["left", "top", "width", "height", "part"],
            },
            description: "Segments for linkedDate fields - separate boxes for day/month/year",
          },
          rows: {
            type: "number",
            description: "Number of visible text lines for textarea fields",
          },
          groupLabel: {
            type: "string",
            description: "Question/header/section text that this field belongs to",
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
