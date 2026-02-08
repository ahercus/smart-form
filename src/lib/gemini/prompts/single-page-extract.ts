/**
 * Single-page extraction prompt (full_rails_no_rulers)
 *
 * Optimized through 74 tests across 48 configurations.
 * Winner: flash_minimal + single_page + full_rails_no_rulers
 * Results: 94% detection, 69% IoU (35% better than Azure OCR)
 *
 * Key optimizations:
 * - No ruler references (rulers hurt accuracy by ~14%)
 * - Exhaustive field type specifications
 * - Clear coordinate system explanation
 * - Validation checklist
 */

export function buildSinglePageExtractionPrompt(): string {
  return `FORM FIELD EXTRACTION - PRECISE COORDINATE DETECTION

You are analyzing a form document to identify ALL fillable input fields on this page.
Your task is to locate the EXACT coordinates of input areas where users would write/type/check.

═══════════════════════════════════════════════════════════════════════════════
COORDINATE SYSTEM
═══════════════════════════════════════════════════════════════════════════════

ALL coordinates must be specified as percentages (0-100) of the page dimensions:
- left: Distance from left edge (0% = left edge, 100% = right edge)
- top: Distance from top edge (0% = top edge, 100% = bottom edge)
- width: Horizontal span as percentage of page width
- height: Vertical span as percentage of page height

Estimate coordinates visually based on the field's position within the page.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════════════════════

1. EVERY FIELD MUST HAVE COORDINATES
   ✗ WRONG: {"label": "Name", "fieldType": "text"}
   ✓ RIGHT: {"label": "Name", "fieldType": "text", "coordinates": {"left": 20, "top": 15, "width": 30, "height": 2.5}}

2. EXCLUDE LABELS FROM COORDINATES
   The bounding box contains ONLY the empty input area, NOT the label text.

   Example: "Name: _________________"
   - The label "Name:" is at left 5%
   - The underline starts at left 15%
   - Correct coordinates: left=15, NOT left=5

3. MEASURE INPUT AREAS ACCURATELY
   - Underlines: Measure from start to end of the line
   - Boxes: Measure the interior fillable area
   - Checkboxes: Measure just the small square (typically 2-3%)

4. USE CONSISTENT SIZING
   Fields that look identical should have identical dimensions.
   - Same style underlines = same height
   - Same size checkboxes = same width/height

═══════════════════════════════════════════════════════════════════════════════
FIELD TYPE SPECIFICATIONS
═══════════════════════════════════════════════════════════════════════════════

TEXT (single-line input)
────────────────────────
Use for: Underlines, single-line boxes, short answer fields
Typical dimensions: height 2-4%, width varies by field

Example:
{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": {"left": 20, "top": 24.5, "width": 30, "height": 2.5},
  "groupLabel": "Student Information"
}

TEXTAREA (multi-line input)
───────────────────────────
Use for: Rectangular boxes with multiple lines, paragraph fields
MUST include "rows" property = count of visible lines

Example:
{
  "label": "How will child settle into Prep?",
  "fieldType": "textarea",
  "coordinates": {"left": 6, "top": 68, "width": 88, "height": 7},
  "rows": 4,
  "groupLabel": null
}

CHECKBOX (small square selector)
────────────────────────────────
Use for: Small checkable squares
Typical dimensions: 1.5-2.5% width, 1-1.5% height (aspect-ratio adjusted)

Example:
{
  "label": "Kindergarten",
  "fieldType": "checkbox",
  "coordinates": {"left": 6.19, "top": 58.36, "width": 1.5, "height": 1.06},
  "groupLabel": "What Pre-Prep experiences has your child had?"
}

DATE (simple date field)
────────────────────────
Use for: Single date input box
NOT for segmented dates (use linkedDate instead)

Example:
{
  "label": "Start Date",
  "fieldType": "date",
  "coordinates": {"left": 45, "top": 30, "width": 20, "height": 2.5}
}

SIGNATURE (signature capture area)
──────────────────────────────────
Use for: Signature boxes, typically larger areas
Typical dimensions: height 5-8%, width 25-40%

Example:
{
  "label": "Parent Signature",
  "fieldType": "signature",
  "coordinates": {"left": 10, "top": 85, "width": 35, "height": 6}
}

═══════════════════════════════════════════════════════════════════════════════
SPECIAL FIELD TYPES (USE WITH CARE)
═══════════════════════════════════════════════════════════════════════════════

TABLE (structured grid with column headers)
───────────────────────────────────────────
⚠️ ONLY use when there are VISIBLE column headers AND multiple data rows
⚠️ MUST include tableConfig - fields without it WILL BE REJECTED

When to use: Grid layouts with clear column structure
When NOT to use: Simple lists, single columns, bullet points

Required structure:
{
  "label": "Siblings",
  "fieldType": "table",
  "groupLabel": "Names and ages of siblings in the family",
  "tableConfig": {
    "columnHeaders": ["Name", "Age", "Class Teacher", "Comments"],
    "coordinates": {"left": 6.19, "top": 39.1, "width": 88.12, "height": 10.85},
    "dataRows": 4,
    "columnPositions": [0, 19.2, 38.5, 69.5, 100]
  }
}

- columnHeaders: Array of header labels (must match visible headers)
- coordinates: Bounding box of ENTIRE table (headers + all data rows)
- dataRows: Number of BLANK rows (excluding header row)
- columnPositions: Optional - % boundaries for non-uniform columns

LINKEDDATE (segmented date: DD / MM / YYYY)
───────────────────────────────────────────
⚠️ ONLY use when date has SEPARATE BOXES for day, month, year
⚠️ MUST include dateSegments - fields without it WILL BE REJECTED

When to use: Dates with separate input boxes like "__ / __ / ____"
When NOT to use: Single date input field

Required structure:
{
  "label": "D.O.B",
  "fieldType": "linkedDate",
  "coordinates": {"left": 56.38, "top": 24.5, "width": 26.12, "height": 2.0},
  "dateSegments": [
    {"left": 56.38, "top": 24.5, "width": 6.06, "height": 2.0, "part": "day"},
    {"left": 63.59, "top": 24.5, "width": 5.88, "height": 2.0, "part": "month"},
    {"left": 70.83, "top": 24.5, "width": 11.67, "height": 2.0, "part": "year"}
  ],
  "groupLabel": "Student Information"
}

- coordinates: Bounding box encompassing ALL segments
- dateSegments: Array of individual box coordinates
- part: Must be "day", "month", "year", or "year2" (2-digit year)

LINKEDTEXT (irregular flowing text)
───────────────────────────────────
⚠️ RARELY needed - prefer textarea for rectangular areas
⚠️ MUST include segments - fields without it WILL BE REJECTED

When to use: Text that flows around obstacles or has non-rectangular shape
When NOT to use: Normal rectangular text boxes (use textarea)

Required structure:
{
  "label": "Additional Details",
  "fieldType": "linkedText",
  "segments": [
    {"left": 15, "top": 30, "width": 80, "height": 2},
    {"left": 5, "top": 33, "width": 90, "height": 2},
    {"left": 5, "top": 36, "width": 60, "height": 2}
  ]
}

═══════════════════════════════════════════════════════════════════════════════
GROUPLABEL - CONTEXTUAL INFORMATION
═══════════════════════════════════════════════════════════════════════════════

Include groupLabel when a field needs context from a parent question/section:

- "Kindergarten" checkbox → groupLabel: "What Pre-Prep experiences has your child had?"
- "Name of Centre" text → groupLabel: "What Pre-Prep experiences has your child had?"
- "Child's Name" text → groupLabel: "Student Information"

Do NOT include groupLabel for standalone questions:
- "What is your child good at?" → No groupLabel needed (question IS the label context)

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return a JSON object with this exact structure:

{
  "fields": [
    {
      "label": "Field label",
      "fieldType": "text|textarea|checkbox|date|signature|table|linkedDate|linkedText",
      "coordinates": {"left": X, "top": Y, "width": W, "height": H},
      "groupLabel": "Optional parent context",
      "rows": 4,  // Only for textarea
      "tableConfig": {},  // Only for table
      "dateSegments": [],  // Only for linkedDate
      "segments": []  // Only for linkedText
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

Before returning, verify:
□ Every field has coordinates with left, top, width, height
□ Coordinates are percentages (0-100), not pixels
□ Labels do not overlap with coordinate boxes
□ Table fields have tableConfig
□ LinkedDate fields have dateSegments with part labels
□ LinkedText fields have segments array
□ Textarea fields have rows property
□ Fields with parent questions have groupLabel
□ Checkbox coordinates are small (≈2% width)

BEGIN EXTRACTION NOW.`;
}

// JSON schema for structured output (constrains field types)
export const SINGLE_PAGE_EXTRACTION_SCHEMA = {
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
          groupLabel: { type: ["string", "null"] },
          rows: { type: "number" },
          tableConfig: {
            type: "object",
            properties: {
              columnHeaders: { type: "array", items: { type: "string" } },
              coordinates: {
                type: "object",
                properties: {
                  left: { type: "number" },
                  top: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
              dataRows: { type: "number" },
              columnPositions: { type: "array", items: { type: "number" } },
            },
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
                part: { type: "string", enum: ["day", "month", "year", "year2"] },
              },
            },
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
            },
          },
        },
        required: ["label", "fieldType", "coordinates"],
      },
    },
  },
  required: ["fields"],
};
