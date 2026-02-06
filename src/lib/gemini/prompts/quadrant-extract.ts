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

  // Boundary ownership rules (simplified)
  const upperBoundaryRule =
    quadrant === 1 ? "" : `If a field crosses your TOP boundary (${range.top}%), skip it.`;

  const lowerBoundaryRule =
    quadrant === 4 ? "" : `If a field crosses your BOTTOM boundary (${range.bottom}%), include it fully.`;

  return `Extract fillable input fields within the PURPLE HIGHLIGHTED REGION (${range.top}%-${range.bottom}% vertically).

COORDINATES ARE PERCENTAGES (0-100) - use the blue 5% grid to measure.

RULES:
1. EXCLUDE LABELS: Box = ONLY the empty input area, NOT the label text
2. FULL WIDTH: Underlines that span the page should have width ≈ 85-90%
3. MULTI-LINE TEXTAREAS: Multiple consecutive lines for one answer = ONE textarea field spanning all lines
4. TABLE CELLS: Each empty cell is a separate text field
5. CHECKBOXES: Small square only (width/height ≈ 2-3%)

UNDERLINE FIELDS:
- If underline starts after a label: left = where underline starts
- If underline spans full page (no label on that line): left ≈ 5-8%

${upperBoundaryRule}
${lowerBoundaryRule}

Field types: text, textarea, date, checkbox, radio, signature, initials, circle_choice

Return JSON:
{
  "fields": [
    { "label": "Name", "fieldType": "text", "coordinates": { "left": 20, "top": 30, "width": 35, "height": 2 } },
    { "label": "Comments", "fieldType": "textarea", "coordinates": { "left": 5, "top": 40, "width": 90, "height": 10 } }
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
        },
        required: ["label", "fieldType", "coordinates"],
      },
    },
    noFieldsInRegion: {
      type: "boolean",
      description: "True if no fillable fields were found in this quadrant",
    },
  },
  required: ["fields", "noFieldsInRegion"],
};
