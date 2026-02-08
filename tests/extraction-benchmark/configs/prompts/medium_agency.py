"""
Medium Agency prompt - Current production prompt.
~130 lines. Balanced guidance with examples.
Includes all special types (table, linkedText, linkedDate).
"""


def build_medium_agency_prompt(quadrant: int | None = None) -> str:
    """
    Build medium agency extraction prompt (production style).

    Args:
        quadrant: Optional quadrant number (1-4) for quadrant mode.
                  None for single-page mode.
    """
    if quadrant:
        ranges = {1: (0, 25), 2: (25, 50), 3: (50, 75), 4: (75, 100)}
        top, bottom = ranges[quadrant]
        region_text = f"within the PURPLE HIGHLIGHTED REGION ({top}%-{bottom}% vertically)"

        if quadrant == 1:
            boundary_rules = f"If a field crosses the BOTTOM of the purple box ({bottom}%), include it fully."
        elif quadrant == 4:
            boundary_rules = f"If a field crosses the TOP of the purple box ({top}%), skip it."
        else:
            boundary_rules = f"If a field crosses the TOP of the purple box ({top}%), skip it. If it crosses the BOTTOM ({bottom}%), include it fully."
    else:
        region_text = "on this page"
        boundary_rules = ""

    return f"""Extract ALL fillable input fields {region_text}.

GUIDING PRINCIPLE: Imagine someone filling this form digitally. Place input boxes where they'd intuitively expect to write. Use common sense.

COORDINATES ARE PERCENTAGES (0-100) - use the ruler in the margins.

EVERY FIELD MUST HAVE coordinates - NO EXCEPTIONS!
{{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": {{ "left": 20, "top": 8, "width": 30, "height": 2.5 }}  ← REQUIRED!
}}

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
{{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": {{...}},
  "groupLabel": "Child's Details"
}}
{{
  "label": "Kindergarten",
  "fieldType": "checkbox",
  "coordinates": {{...}},
  "groupLabel": "What Pre-Prep experiences has your child had?"
}}
- groupLabel captures the question/header/section that the field belongs to
- Include for ANY field where the label alone doesn't explain what info is needed

MULTI-LINE TEXT AREAS:
- For rectangular multi-line text boxes, use "textarea" with normal coordinates
- CRITICAL: Include "rows" property = count of visible horizontal lines in the textarea box
- The rows value helps render the field correctly (text aligns to lines)
- For irregular/non-rectangular flowing text (rare), use linkedText with segments

Example textarea:
{{
  "label": "How will child settle into Prep?",
  "fieldType": "textarea",
  "coordinates": {{ "left": 6, "top": 68, "width": 88, "height": 7 }},
  "rows": 4
}}

SPECIAL TOOL - TABLE (ONLY for structured grids with column headers):
⚠️ DO NOT use table for simple lists or single-column areas - use textarea instead!
⚠️ TABLE FIELDS WITHOUT tableConfig WILL BE REJECTED!
{{
  "fieldType": "table",
  "label": "Siblings",
  "tableConfig": {{
    "columnHeaders": ["Name", "Age", "Teacher", "Comments"],
    "coordinates": {{ "left": 5, "top": 30, "width": 90, "height": 15 }},
    "dataRows": 4
  }}
}}
- ONLY use table when there are VISIBLE column headers AND multiple data rows
- tableConfig with columnHeaders, coordinates, and dataRows is MANDATORY
- dataRows = number of BLANK rows (NOT counting the header row)
- columnPositions = optional, for non-uniform column widths as % boundaries [0, 20, 35, 60, 100]

SPECIAL TOOL - LINKED TEXT (ONLY for irregular flowing text):
⚠️ DO NOT use linkedText for simple multi-line boxes - use textarea instead!
⚠️ LINKEDTEXT FIELDS WITHOUT segments WILL BE REJECTED!
{{
  "fieldType": "linkedText",
  "label": "Details",
  "segments": [
    {{ "left": 15, "top": 30, "width": 80, "height": 2 }},
    {{ "left": 5, "top": 33, "width": 90, "height": 2 }}
  ]
}}
- ONLY use linkedText when text flows across MULTIPLE NON-ALIGNED lines (like text that wraps around an image)
- segments array is REQUIRED - each segment is a separate line/region
- For simple rectangular multi-line areas, use textarea with normal coordinates instead

SPECIAL TOOL - LINKED DATE (for segmented date fields like __ / __ / ____):
⚠️ DO NOT use linkedDate for simple date fields - use date instead!
⚠️ LINKEDDATE FIELDS WITHOUT dateSegments WILL BE REJECTED!
{{
  "fieldType": "linkedDate",
  "label": "D.O.B",
  "dateSegments": [
    {{ "left": 45, "top": 12, "width": 4, "height": 2.5, "part": "day" }},
    {{ "left": 52, "top": 12, "width": 4, "height": 2.5, "part": "month" }},
    {{ "left": 59, "top": 12, "width": 6, "height": 2.5, "part": "year" }}
  ]
}}
- Use when date has SEPARATE BOXES for day, month, year (e.g., "__ / __ / ____")
- Each segment needs coordinates AND a "part": "day", "month", "year", or "year2"
- "year" = 4 digits (2026), "year2" = 2 digits (26)
- For simple single-box date fields, use "date" with normal coordinates instead

{boundary_rules}

Field types: text, textarea, date, checkbox, radio, signature, initials, circle_choice, table, linkedText, linkedDate
- text = single-line input
- textarea = multi-line rectangular box (PREFER THIS over linkedText!)

Return JSON - EVERY field needs coordinates:
{{
  "fields": [
    {{ "label": "...", "fieldType": "text", "coordinates": {{ "left": X, "top": Y, "width": W, "height": H }} }}
  ],
  "noFieldsInRegion": false
}}"""


# All field types supported
MEDIUM_AGENCY_FIELD_TYPES = [
    "text", "textarea", "date", "checkbox", "radio",
    "signature", "initials", "circle_choice",
    "table", "linkedText", "linkedDate"
]
