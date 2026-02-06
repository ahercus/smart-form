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

  // Boundary ownership rules
  const upperBoundaryRule =
    quadrant === 1
      ? "" // Q1 has no upper boundary to worry about
      : `
### Upper Boundary Rule (CRITICAL)
If a field INTERSECTS with the ${range.top}% line (your upper boundary):
- **IGNORE IT** - another agent will handle it
- A field "intersects" if its TOP coordinate is less than ${range.top}% but its BOTTOM extends into your region
- Do NOT include partial fields that start above your region`;

  const lowerBoundaryRule =
    quadrant === 4
      ? "" // Q4 has no lower boundary ownership
      : `
### Lower Boundary Rule (CRITICAL)
If a field INTERSECTS with the ${range.bottom}% line (your lower boundary):
- **YOU OWN IT** - include it in your output
- A field "intersects" if it starts within your region but extends past ${range.bottom}%
- Include the FULL field even if it extends into the next quadrant`;

  return `You are analyzing page ${pageNumber} of a PDF form to extract fillable field coordinates.

## CRITICAL BOUNDING BOX RULES (READ FIRST)

1. **EXCLUDE LABELS**: The bounding box must contain ONLY the empty input area, NOT the label text.
   - WRONG: Box includes "Name:" label
   - RIGHT: Box starts where the underline/input space begins
   - The label is separate from where the user writes

2. **TIGHT FIT**: Box should fit tightly around the visual input container.
   - Look for: underlines, rectangles, boxes, table cells
   - NOT: floating text, headers, static content

3. **VISUAL CONTAINERS**: Identify the actual input element:
   - Underline fields: Box covers the line only, not the label before it
   - Box fields: Match the rectangle boundaries exactly
   - Checkboxes: The small square icon only
   - Table cells: The cell boundary, not the header

4. **MULTI-LINE = ONE FIELD**: Multiple consecutive blank lines under a single question = ONE textarea, not separate fields.
   - Example: "Provide details: _____ _____ _____" = 1 textarea covering all 3 lines

## Your Focus Region (QUADRANT ${quadrant})
- **Top boundary**: ${range.top}%
- **Bottom boundary**: ${range.bottom}%
- Look for the PURPLE HIGHLIGHTED REGION - that's your area
- A BLUE GRID has been overlaid on the image as a visual aid for coordinate measurement
- Grid lines are spaced at 5% intervals - use them to measure coordinates precisely

${upperBoundaryRule}
${lowerBoundaryRule}

## Coordinate System
- All values are PERCENTAGES (0-100) relative to the FULL PAGE
- left=0 is left edge, left=100 is right edge
- top=0 is top edge, top=100 is bottom edge

## Field Types (use your judgment)
- **text**: Single-line text input
- **textarea**: Multi-line text area
- **date**: Date input
- **checkbox**: Checkbox (square)
- **radio**: Radio button (circle)
- **circle_choice**: "Circle one" style - printed options user circles (include choiceOptions array)
- **signature**: Signature field
- **initials**: Initials field

## Circle-Choice Example
\`\`\`json
{
  "label": "Has insurance",
  "fieldType": "circle_choice",
  "coordinates": { "left": 60, "top": 32, "width": 15, "height": 3 },
  "choiceOptions": [
    { "label": "Yes", "coordinates": { "left": 60, "top": 32, "width": 5, "height": 3 } },
    { "label": "No", "coordinates": { "left": 68, "top": 32, "width": 4, "height": 3 } }
  ]
}
\`\`\`

## What NOT to Include
- Static text, headers, section titles
- Page numbers, logos, decorative elements
- Fields OUTSIDE your purple region
- Fields intersecting your UPPER boundary (unless Quadrant 1)

## Response Format
Return ONLY valid JSON with an array of fields:
\`\`\`json
{
  "fields": [
    {
      "label": "First Name",
      "fieldType": "text",
      "coordinates": { "left": 25, "top": ${range.top + 5}, "width": 30, "height": 4 }
    },
    {
      "label": "Date of Birth",
      "fieldType": "date",
      "coordinates": { "left": 25, "top": ${range.top + 12}, "width": 20, "height": 4 }
    },
    {
      "label": "Gender",
      "fieldType": "circle_choice",
      "coordinates": { "left": 60, "top": ${range.top + 12}, "width": 20, "height": 4 },
      "choiceOptions": [
        { "label": "Male", "coordinates": { "left": 60, "top": ${range.top + 12}, "width": 8, "height": 4 } },
        { "label": "Female", "coordinates": { "left": 70, "top": ${range.top + 12}, "width": 10, "height": 4 } }
      ]
    }
  ],
  "noFieldsInRegion": false
}
\`\`\`

If there are NO fillable fields in your region, return:
\`\`\`json
{
  "fields": [],
  "noFieldsInRegion": true
}
\`\`\`

**CRITICAL**: Double-check that ALL field coordinates are within your region (${range.top}%-${range.bottom}% vertically).
Return ONLY the JSON object, nothing else.`;
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
