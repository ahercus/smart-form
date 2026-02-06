export function buildGlobalAuditPrompt(
  pageNumber: number,
  existingFieldIds: string[],
  existingFields?: Array<{ id: string; label: string; fieldType: string }>
): string {
  return `You are the GLOBAL FORM AUDITOR for page ${pageNumber}.

## What You See
The ENTIRE page of a form document (could be: native PDF, scanned paper, or phone photo).
Colored boxes show fields already detected and positioned by precision QC.

## Your Mandate
You are the FINAL JUDGE on field validity. Local QC handles positioning; you handle existence.

### 1) AUDIT VALIDITY (Kill Noise)
Remove field IDs ONLY if the box covers something that is CLEARLY NOT a fillable field:

**REMOVE these (be aggressive):**
- **Single letters in logos**: "X", "O", "E" characters in the page header/logo area (top 15% of page)
- **Section headers**: "APPLICATION FOR...", "PERSONAL DETAILS", "SCHOOL DETAILS" - these are titles, NOT fields
- **Organization names**: "KELVIN GROVE STATE COLLEGE", company names in headers
- **Footer info** (bottom 10% of page): phone "(07) 3552 7333", email "info@...", "Fax:", "Email:", "Web Site:", addresses
- **Checkbox placeholders**: labels like "Checkbox 18" with no actual checkbox
- **Static contact labels**: "Phone:", "Fax:", "Email:" when they're just labels in footer (no input area)

**DO NOT REMOVE these:**
- Fields with underlines, boxes, or checkboxes visible (even if box is slightly off)
- Circle-choice options (Yes/No, Male/Female) even if box placement isn't perfect
- Any box where there's a CLEAR input area nearby

### 2) DISCOVER MISSED FIELDS
Find fillable areas with NO colored box:
- Underlines without blue boxes
- Empty boxes/rectangles without overlays
- Checkboxes without green boxes
- Yes/No options without orange circle_choice boxes
- Signature lines without red boxes

### 3) CONTEXT EXTRACTION
One short phrase: what is this page about? (e.g., "Personal & School Details", "Medical History")

### 4) ORIENTATION
Report: "upright", "rotated-left", "rotated-right", or "upside-down"

## Fields Already Detected (with colored boxes):${existingFields && existingFields.length > 0 ? `
${existingFields.map((f) => `- ID: ${f.id.slice(0, 8)}... | Label: "${f.label}" | Type: ${f.fieldType}`).join("\n")}

These colored boxes show WHERE these fields are. Do NOT re-add them as new fields.` : existingFieldIds.length > 0 ? `
${existingFieldIds.map((id) => `- ${id.slice(0, 8)}...`).join("\n")}` : " (None - treat as fresh detection)"}

## CRITICAL: Coordinate System
All coordinates MUST be **percentages (0-100)** relative to the full page:
- left=0 is the LEFT edge, left=100 is the RIGHT edge
- top=0 is the TOP edge, top=100 is the BOTTOM edge
- A field halfway across should be left≈50, not 500 or 5000

**DO NOT use pixel coordinates.** Use the grid lines to estimate percentages.

## Response Format (JSON ONLY)
{
  "adjustments": [],
  "newFields": [
    { "label": "Missed Field", "fieldType": "text", "coordinates": { "left": 50, "top": 60, "width": 20, "height": 4 } }
  ],
  "removeFields": ["only-noise-field-ids"],
  "fieldsValidated": true,
  "pageContext": "Section summary",
  "orientation": "upright"
}

Example coordinates (PERCENTAGES):
- A field at the top-left quarter: { "left": 10, "top": 15, "width": 30, "height": 4 }
- A field at the bottom-right: { "left": 60, "top": 80, "width": 25, "height": 3 }

Return ONLY JSON. No explanations.`;
}
