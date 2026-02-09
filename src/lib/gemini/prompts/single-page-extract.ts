/**
 * Single-page extraction prompt (full_rails_no_rulers)
 *
 * Key design:
 * - No ruler references (rulers hurt accuracy in testing)
 * - Exhaustive field type specifications
 * - Clear coordinate system explanation
 * - Generic examples (no form-specific coordinates)
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

2. EXCLUDE LABELS FROM COORDINATES - CRITICAL
   The bounding box contains ONLY the empty input area, NOT the label text.
   The LEFT coordinate must be where the UNDERLINE or BOX visually STARTS.

   Example: "Name: _________________"
   - The label "Name:" ends at approximately left 14%
   - The underline STARTS at left 15% (where the line begins, NOT where the label ends)
   - Correct coordinates: left=15, NOT left=5 or left=14

   COMMON MISTAKE: Starting the box too far left, overlapping with label text.
   ALWAYS measure from where the INPUT AREA visually begins.

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
  "label": "Full Name",
  "fieldType": "text",
  "coordinates": {"left": 18, "top": 12, "width": 35, "height": 2.5},
  "groupLabel": "Personal Details"
}

TEXTAREA (multi-line input)
───────────────────────────
Use for: Rectangular boxes with multiple lines, paragraph fields
MUST include "rows" property = count of visible lines

Example:
{
  "label": "Additional Comments",
  "fieldType": "textarea",
  "coordinates": {"left": 5, "top": 45, "width": 90, "height": 8},
  "rows": 4,
  "groupLabel": null
}

CHECKBOX (small square selector)
────────────────────────────────
Use for: Small checkable squares
Typical dimensions: 1.5-2.5% width, 1-1.5% height (aspect-ratio adjusted)

Example:
{
  "label": "Option A",
  "fieldType": "checkbox",
  "coordinates": {"left": 5, "top": 32, "width": 2, "height": 1.2},
  "groupLabel": "Select all that apply"
}

DATE (simple date field)
────────────────────────
Use for: Single date input box
NOT for segmented dates (use linkedDate instead)

Example:
{
  "label": "Effective Date",
  "fieldType": "date",
  "coordinates": {"left": 60, "top": 15, "width": 22, "height": 2.5}
}

SIGNATURE (signature capture area)
──────────────────────────────────
Use for: Signature boxes, typically larger areas
Typical dimensions: height 5-8%, width 25-40%

Example:
{
  "label": "Applicant Signature",
  "fieldType": "signature",
  "coordinates": {"left": 8, "top": 88, "width": 30, "height": 5}
}

INITIALS (initials capture area)
─────────────────────────────────
Use for: Small boxes labeled "initials" or "initial here"
Typical dimensions: height 3-5%, width 10-20% (smaller than signature)

Example:
{
  "label": "Applicant Initials",
  "fieldType": "initials",
  "coordinates": {"left": 70, "top": 92, "width": 12, "height": 3}
}

CIRCLE_CHOICE (circle/select one of printed options)
────────────────────────────────────────────────────
Use for: Printed text options where the user circles their answer (e.g., "Yes / No", "Male / Female / Other")
⚠️ MUST include choiceOptions - fields without them WILL BE REJECTED
⚠️ NOT for checkboxes (small squares) — use checkbox instead

When to use: Text like "Yes/No", "Circle one: A / B / C", or printed options separated by slashes
When NOT to use: Checkbox squares, radio buttons, or fill-in-the-blank fields

Required structure:
{
  "label": "Do you have your own equipment?",
  "fieldType": "circle_choice",
  "coordinates": {"left": 5, "top": 60, "width": 15, "height": 2.5},
  "choiceOptions": [
    {"label": "Yes", "coordinates": {"left": 5, "top": 60, "width": 5, "height": 2.5}},
    {"label": "No", "coordinates": {"left": 12, "top": 60, "width": 5, "height": 2.5}}
  ]
}

- coordinates: Bounding box encompassing ALL options
- choiceOptions: Array of individual option positions (where each printed word appears)

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
  "label": "Employee List",
  "fieldType": "table",
  "groupLabel": "Team Members",
  "tableConfig": {
    "columnHeaders": ["Name", "Role", "Start Date"],
    "coordinates": {"left": 5, "top": 35, "width": 90, "height": 12},
    "dataRows": 5,
    "columnPositions": [0, 40, 70, 100]
  }
}

- columnHeaders: Array of header labels (must match visible headers)
- coordinates: Bounding box of the DATA ROWS ONLY (EXCLUDE the header row). Top should be where the first blank data row starts.
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
  "label": "Date of Birth",
  "fieldType": "linkedDate",
  "coordinates": {"left": 50, "top": 18, "width": 28, "height": 2.5},
  "dateSegments": [
    {"left": 50, "top": 18, "width": 7, "height": 2.5, "part": "day"},
    {"left": 58, "top": 18, "width": 7, "height": 2.5, "part": "month"},
    {"left": 66, "top": 18, "width": 12, "height": 2.5, "part": "year"}
  ],
  "groupLabel": "Personal Details"
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

- "Yes" checkbox → groupLabel: "Do you have a driver's license?"
- "Policy Number" text → groupLabel: "Insurance Information"
- "First Name" text → groupLabel: "Applicant Details"

Do NOT include groupLabel for standalone questions:
- "What is your occupation?" → No groupLabel needed (question IS the label context)

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

// JSON schema for structured output - simplified to avoid nesting depth limits
// Gemini limits nesting to ~5 levels, so we use "object" type without nested properties
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
          // Coordinates as object - internal structure enforced by prompt
          coordinates: { type: "object" },
          groupLabel: { type: "string", nullable: true },
          rows: { type: "number" },
          // Complex nested types simplified to avoid depth limits
          tableConfig: { type: "object" },
          dateSegments: { type: "array" },
          segments: { type: "array" },
          choiceOptions: { type: "array" },
        },
        required: ["label", "fieldType", "coordinates"],
      },
    },
  },
  required: ["fields"],
};
