import type { ExtractedField } from "../../types";

export function buildFieldReviewPrompt(
  pageNumber: number,
  fields: ExtractedField[],
  hasDocumentAIFields: boolean,
  isCroppedView: boolean = false,
  cleanImage: boolean = false
): string {
  const fieldsJson =
    fields.length > 0
      ? JSON.stringify(
          fields.map((f) => ({
            id: f.id,
            label: f.label,
            fieldType: f.field_type,
            coordinates: f.coordinates,
          })),
          null,
          2
        )
      : "[]";

  if (hasDocumentAIFields) {
    const imageDescription = cleanImage
      ? `The image shows the RAW form with a coordinate grid. NO field boxes are drawn - you must find the correct positions yourself.`
      : `The image shows the form WITH colored boxes overlaid representing fields detected by Document AI.`;

    const fieldListDescription = cleanImage
      ? `## Azure-Detected Fields (listed below - NOT drawn on image)
These fields were detected by Azure Document AI, but the positions may be WRONG (often boxes cover labels instead of input areas).
Your job: Find the CORRECT positions for these fields by looking at the actual form.
${fieldsJson}`
      : `## Detected Fields (shown as colored boxes in image)
${fieldsJson}`;

    return `You are reviewing page ${pageNumber} of a PDF form. ${imageDescription}

${fieldListDescription}

## Your QC Task
You are the PRECISION FORM MAPPING TECHNICIAN. You see a horizontal slice with full context (labels + inputs).

Review and fix:
1. **RECLASSIFY** - CRITICAL: Fix wrong field types FIRST:
   - If you see "Yes/No" or "Yes / No" printed on the form → fieldType MUST be "circle_choice", NOT "text"
   - If text says "AT KGSC: YES/NO" → that's circle_choice with options [{label: "YES"}, {label: "NO"}]
   - If text says "Golf experience if any? Yes/No" → circle_choice
   - If marked as "text" but it's actually a checkbox → change to "checkbox"
   
2. **VERIFY** - Are box positions accurate? Do they cover input areas?

3. **ADJUST** - If misaligned or wrong size, provide corrected coordinates

4. **ADD** - If fillable fields were MISSED, add them

5. **REMOVE** - Flag for removal if:
   - Covers static text, headers, section titles
   - Floating in margins with no input area
   - Decorative elements, logos, page numbers
   - No corresponding underline/box/checkbox visible

6. **MERGE TABLE CELLS** - Multiple small boxes in ONE table cell → REMOVE small boxes, create ONE field per cell

## CRITICAL: Field Positioning for Different Form Styles

Forms use different styles for input areas. Position boxes correctly for each:

### Underline-style fields (most common)
Format: "LABEL: _______________" or "Name ___________"

**KEY INSIGHT 1 - HORIZONTAL**: The box should cover the UNDERLINE, NOT the label text!
- If you see "NAME: ___________", the box goes over "___________", NOT over "NAME:"
- The LEFT coordinate should be where the underline STARTS (after the label ends)
- Example: If "NAME:" ends at 25% and underline starts there, set left=25

**KEY INSIGHT 2 - VERTICAL**: People write ABOVE underlines, not below them. The underline is a BASELINE.

**CONCRETE EXAMPLE with coordinates:**
If you see "NAME: ___________" where:
- The label "NAME:" spans from left=5% to left=20%
- The underline starts at left=22% and ends at left=60%
- The underline is at top=27%

CORRECT box coordinates:
- left=22% (where underline STARTS, not where label is)
- top=24% (2-3% above the underline)
- width=38% (covers the full underline length: 60-22=38)
- height=4%

WRONG coordinates:
- left=5% (this is where the label is, not the input area!)
- top=29% (this is below the line - empty space)

The LEFT coordinate = where the underline STARTS (after the label).
The TOP coordinate = 2-4% HIGHER (smaller number) than the underline position.

Positioning rules:
- Find where the underline IS (e.g., 27% from top)
- Set TOP to 2-4% ABOVE that (e.g., 24% if underline is at 27%)
- Set HEIGHT to 4-5% to capture writing space + underline
- The box should STRADDLE the line, not sit below it

### Box-style fields
Format: A visible rectangle/box drawn on the form
- The input area is INSIDE the drawn rectangle
- The box should match the rectangle boundaries exactly

### Blank-space fields
Format: Just empty space after a label with no visible line/box
- The input area is the blank space after the label
- Estimate a reasonable width based on expected content

### Multi-line input areas (textarea)
When a question is followed by multiple lines for a response:
- If the FIRST line is only a PARTIAL line (follows the question text), START the text box from the SECOND line
- The partial first line would cause text to overlay the question
- Example: "Please describe: ________" with 3 blank lines below
  - WRONG: Start text box at the partial line after "describe:" - text will cover the question
  - CORRECT: Start text box at the first FULL blank line below

IMPORTANT: Most PDF forms use underline-style. The boxes must capture WHERE TEXT IS WRITTEN (above the line), not empty space below the line!

## CRITICAL: Table Detection
Document AI often fragments table cells into multiple small boxes. Look for:
- Tables with column headers (e.g., "First Name", "Last Name", "Phone")
- Multiple tiny boxes within a single table cell - these should be MERGED into ONE field
- Each table row should have one field per column, sized to match the column width

When you find fragmented table cells:
1. Add ALL the small field IDs to "removeFields"
2. Create ONE new field per actual table cell with:
   - Coordinates spanning the full cell width
   - Label matching the column header (e.g., "First Name - Row 1")
   - Proper field type

## Circle-Choice Fields

Use fieldType "circle_choice" when options are printed and the user circles one:
- Yes/No, Male/Female, AM/PM, Grade levels, etc.
- Measure each option's position precisely using the 10% grid labels

{
  "label": "Own equipment",
  "fieldType": "circle_choice",
  "coordinates": { "left": 70, "top": 66, "width": 12, "height": 3 },
  "choiceOptions": [
    { "label": "Yes", "coordinates": { "left": 70, "top": 66, "width": 5, "height": 3 } },
    { "label": "No", "coordinates": { "left": 77, "top": 66, "width": 4, "height": 3 } }
  ]
}

## Response Format
Return ONLY valid JSON:
{
  "adjustments": [
    {
      "fieldId": "existing-field-id",
      "action": "update",
      "changes": {
        "label": "Corrected Label",
        "fieldType": "date",
        "coordinates": { "left": 10, "top": 20, "width": 30, "height": 5 }
      }
    }
  ],
  "newFields": [
    {
      "label": "Missed Field Label",
      "fieldType": "text",
      "coordinates": { "left": 50, "top": 60, "width": 20, "height": 4 }
    },
    {
      "label": "Has allergies",
      "fieldType": "circle_choice",
      "coordinates": { "left": 50, "top": 70, "width": 12, "height": 4 },
      "choiceOptions": [
        { "label": "Yes", "coordinates": { "left": 50, "top": 70, "width": 5, "height": 4 } },
        { "label": "No", "coordinates": { "left": 57, "top": 70, "width": 5, "height": 4 } }
      ]
    }
  ],
  "removeFields": ["field-id-to-remove"],
  "fieldsValidated": true
}

Important: Coordinates are percentages (0-100) relative to ${isCroppedView ? `the VISIBLE IMAGE you are seeing.

**CRITICAL - COORDINATE SYSTEM:**
- This is a CROPPED section of the full page
- The grid labels (0, 10, 20... 100) show percentages of THIS visible image
- left=0 means the LEFT edge of THIS image, left=100 means the RIGHT edge
- top=0 means the TOP edge of THIS image, top=100 means the BOTTOM edge
- A field horizontally centered in what you see should have left≈50
- DO NOT try to guess full-page coordinates - use only what you see` : "page dimensions"}.
Return ONLY the JSON object, nothing else.`;
  } else {
    return `You are analyzing page ${pageNumber} of a PDF form. The image shows the form with a grid overlay to help you identify positions.

## Your Task
Document AI did not detect any fields on this page. You need to:
1. **IDENTIFY** all fillable form fields (text boxes, checkboxes, date fields, signature areas, etc.)
2. **LOCATE** each field precisely using the grid as reference
3. **CLASSIFY** each field by type
4. **LABEL** each field based on nearby text labels

## Field Types to Look For
- text: Single-line text input (name, email, phone, etc.)
- textarea: Multi-line text area (comments, descriptions, addresses)
- date: Date input fields
- checkbox: Checkboxes or tick boxes
- radio: Radio button groups
- circle_choice: "Circle your answer" fields (Yes/No, multiple choice where user circles one)
- signature: Signature lines or boxes (full signature)
- initials: Initial boxes (small boxes for writing initials, often near signature lines or at bottom of pages)

## Circle-Choice Fields
Use circle_choice when options are printed and user circles one (Yes/No, Male/Female, etc.):
{
  "label": "Has allergies",
  "fieldType": "circle_choice",
  "coordinates": { "left": 50, "top": 70, "width": 12, "height": 4 },
  "choiceOptions": [
    { "label": "Yes", "coordinates": { "left": 50, "top": 70, "width": 5, "height": 4 } },
    { "label": "No", "coordinates": { "left": 57, "top": 70, "width": 5, "height": 4 } }
  ]
}

## Response Format
Return ONLY valid JSON:
{
  "adjustments": [],
  "newFields": [
    {
      "label": "First Name",
      "fieldType": "text",
      "coordinates": { "left": 25, "top": 15, "width": 30, "height": 4 }
    },
    {
      "label": "Date of Birth",
      "fieldType": "date",
      "coordinates": { "left": 25, "top": 22, "width": 20, "height": 4 }
    }
  ],
  "removeFields": [],
  "fieldsValidated": true
}

Important: Coordinates are percentages (0-100) relative to ${isCroppedView ? `the VISIBLE IMAGE.

**CRITICAL - COORDINATE SYSTEM:**
- This is a CROPPED section - use coords relative to THIS visible area
- left=0 is LEFT edge, left=100 is RIGHT edge of what you see
- top=0 is TOP edge, top=100 is BOTTOM edge of what you see` : "page dimensions"}.
Use the grid lines to estimate positions accurately.
Return ONLY the JSON object, nothing else.`;
  }
}

export function buildFieldQCPrompt(
  pageNumber: number,
  fields: ExtractedField[],
  pageImageDescription: string
): string {
  const fieldsJson = JSON.stringify(
    fields.map((f) => ({
      id: f.id,
      label: f.label,
      fieldType: f.field_type,
      coordinates: f.coordinates,
      value: f.value,
    })),
    null,
    2
  );

  return `You are performing quality control on detected form fields for page ${pageNumber}.

## Current Fields
${fieldsJson}

## Image Context
${pageImageDescription}

## Your Task
Review the field detections and suggest adjustments:
1. Are there any fields that were missed?
2. Are any field boundaries incorrect?
3. Are any field types misclassified?
4. Are any field labels unclear or incorrect?

## Response Format
Return ONLY valid JSON:
{
  "adjustments": [
    {
      "fieldId": "existing-field-id",
      "action": "update",
      "changes": {
        "label": "Corrected Label",
        "fieldType": "date",
        "coordinates": { "left": 10, "top": 20, "width": 30, "height": 5 }
      }
    }
  ],
  "newFields": [
    {
      "label": "Missed Field",
      "fieldType": "text",
      "coordinates": { "left": 50, "top": 60, "width": 20, "height": 4 }
    }
  ],
  "removeFields": ["field-id-to-remove"],
  "confidence": 0.95
}

Return ONLY the JSON object, nothing else.`;
}
