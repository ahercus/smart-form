"""
10 High Agency prompt variations for A/B testing.
All maintain high agency philosophy (trust the model) but vary in:
- Context amount
- Direction specificity
- Examples (yes/no)
- Verbosity
- Focus areas
"""


def build_variant_1_ultra_minimal(quadrant: int | None = None) -> str:
    """Ultra minimal - just the task, nothing else."""
    return """Find all input fields in this form. Return JSON:
{"fields": [{"label": "...", "fieldType": "...", "coordinates": {"left": %, "top": %, "width": %, "height": %}}]}

Field types: text, textarea, checkbox, date, signature, table, linkedDate"""


def build_variant_2_contextual(quadrant: int | None = None) -> str:
    """More context about the purpose."""
    return """You're helping digitize paper forms. We need to identify where users will write/check/sign.

Extract every fillable field from this form image. For each field provide:
- label: the field's purpose (from nearby text)
- fieldType: text, textarea, checkbox, date, signature, table, linkedDate
- coordinates: {left, top, width, height} as percentages (0-100) of image dimensions

The coordinates should tightly bound ONLY the input area (underline, box, checkbox square) - never include the label text.

Tables should include tableConfig with column headers and row count.
Date fields with separate day/month/year boxes use linkedDate with dateSegments.

Return: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_3_example_driven(quadrant: int | None = None) -> str:
    """Include a worked example."""
    return """Extract fillable fields from this form.

Example output for a field labeled "Name:" with an underline input area:
{
  "label": "Name",
  "fieldType": "text",
  "coordinates": {"left": 15.5, "top": 22.3, "width": 35.0, "height": 2.0}
}

Field types available:
- text: single-line text input (underlines, boxes)
- textarea: multi-line text area
- checkbox: small square to check
- date: date input
- signature: signature area
- table: structured table with tableConfig {columnHeaders, coordinates, dataRows}
- linkedDate: segmented date (day/month/year boxes) with dateSegments array

Coordinates are percentages (0-100). Only box the INPUT area, not labels.

Return: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_4_conversational(quadrant: int | None = None) -> str:
    """Friendly, casual tone."""
    return """Hey! I need you to find all the spots on this form where someone would write, check a box, or sign.

For each one, tell me:
- What it's for (the label)
- What type it is (text, textarea, checkbox, date, signature, table, or linkedDate)
- Where it is (left, top, width, height as percentages 0-100)

Quick tips:
- Just outline the actual input space, not the label text
- Checkboxes are tiny squares
- If you see a table, use type "table" and include tableConfig
- Date fields with separate boxes for day/month/year are "linkedDate"

Give me JSON like: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_5_structured(quadrant: int | None = None) -> str:
    """Clear structured sections."""
    return """# TASK
Extract all fillable input fields from this form image.

# OUTPUT FORMAT
JSON object with "fields" array. Each field requires:
- label (string): field purpose
- fieldType (string): text | textarea | checkbox | date | signature | table | linkedDate
- coordinates (object): {left, top, width, height} as percentages 0-100

# SPECIAL TYPES
- table: add tableConfig {columnHeaders: string[], coordinates: {}, dataRows: number}
- linkedDate: add dateSegments [{left, top, width, height, part: "day"|"month"|"year"}]

# KEY RULE
Coordinates = input area only (the box/line/checkbox), NOT the label text.

# RESPONSE
{"fields": [...], "noFieldsInRegion": false}"""


def build_variant_6_precision_focused(quadrant: int | None = None) -> str:
    """Emphasize coordinate precision."""
    return """Extract form fields with PRECISE coordinates.

For each fillable field, measure carefully:
- left: exact left edge of input area (% from image left)
- top: exact top edge (% from image top)
- width: exact width of input area only
- height: exact height of input area only

Be precise to 1 decimal place. The coordinates must tightly bound the actual input space - underlines, boxes, checkboxes - without including any label text.

Field types: text, textarea, checkbox, date, signature, table, linkedDate

Tables need tableConfig with columnHeaders and row count.
Segmented dates (separate day/month/year) need linkedDate with dateSegments.

Return: {"fields": [{"label": "...", "fieldType": "...", "coordinates": {...}}], "noFieldsInRegion": false}"""


def build_variant_7_type_focused(quadrant: int | None = None) -> str:
    """Emphasize correct field type selection."""
    return """Identify and classify all input fields in this form.

FIELD TYPE GUIDE:
- text: Single-line inputs (underlines, small boxes, blank lines)
- textarea: Multi-line text areas (large boxes with multiple lines)
- checkbox: Small squares meant to be checked/ticked
- date: Date entry fields
- signature: Areas designated for signatures
- table: Structured tables - use tableConfig {columnHeaders, coordinates, dataRows}
- linkedDate: Date split into segments (day/month/year boxes) - use dateSegments array

Choose the most specific type that fits. If unsure between text and textarea, prefer text for single lines.

For each field provide:
- label: what the field collects
- fieldType: from the list above
- coordinates: {left, top, width, height} as percentages, input area only

Return: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_8_confidence_based(quadrant: int | None = None) -> str:
    """Only include fields you're confident about."""
    return """Find input fields in this form. Only include fields you're confident about.

For each clear input field:
- label: the field's purpose
- fieldType: text, textarea, checkbox, date, signature, table, or linkedDate
- coordinates: {left, top, width, height} as percentages (0-100)

Skip anything ambiguous. We want high precision - it's better to miss a field than include something wrong.

Coordinates should tightly wrap just the input area (box, line, checkbox), never the label.

Tables: include tableConfig with columnHeaders and dataRows count.
Segmented dates: use linkedDate with dateSegments for day/month/year parts.

Return: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_9_completeness_focused(quadrant: int | None = None) -> str:
    """Emphasize finding ALL fields."""
    return """Carefully scan this entire form and find EVERY input field. Don't miss any.

Look for:
- Underlined spaces for writing
- Empty boxes and text areas
- Checkboxes (small squares)
- Date fields (especially segmented day/month/year)
- Signature areas
- Tables with fillable cells

For each field provide:
- label: what information goes there
- fieldType: text, textarea, checkbox, date, signature, table, or linkedDate
- coordinates: {left, top, width, height} as percentages (input area only, not labels)

Special handling:
- Tables: include tableConfig {columnHeaders, coordinates, dataRows}
- Segmented dates: use linkedDate with dateSegments array

Be thorough. Check every section of the form.

Return: {"fields": [...], "noFieldsInRegion": false}"""


def build_variant_10_balanced(quadrant: int | None = None) -> str:
    """Balanced middle-ground approach."""
    return """Analyze this form and extract all fillable input fields.

Output JSON with a "fields" array. Each field needs:
- label: descriptive name for the field
- fieldType: one of [text, textarea, checkbox, date, signature, table, linkedDate]
- coordinates: {left, top, width, height} in percentages (0-100)

Important:
- Coordinates bound the INPUT area only (line, box, checkbox) - exclude label text
- Tables require tableConfig: {columnHeaders: [...], coordinates: {...}, dataRows: N}
- Date fields with separate day/month/year boxes use linkedDate with dateSegments

Be accurate with both field detection and coordinate placement.

Return: {"fields": [...], "noFieldsInRegion": false}"""


# Map variant names to functions
VARIANTS = {
    "v1_ultra_minimal": build_variant_1_ultra_minimal,
    "v2_contextual": build_variant_2_contextual,
    "v3_example_driven": build_variant_3_example_driven,
    "v4_conversational": build_variant_4_conversational,
    "v5_structured": build_variant_5_structured,
    "v6_precision_focused": build_variant_6_precision_focused,
    "v7_type_focused": build_variant_7_type_focused,
    "v8_confidence_based": build_variant_8_confidence_based,
    "v9_completeness_focused": build_variant_9_completeness_focused,
    "v10_balanced": build_variant_10_balanced,
}

# Descriptions for each variant
VARIANT_DESCRIPTIONS = {
    "v1_ultra_minimal": "Bare minimum - just the task",
    "v2_contextual": "More context about purpose",
    "v3_example_driven": "Includes worked example",
    "v4_conversational": "Friendly casual tone",
    "v5_structured": "Clear sections with headers",
    "v6_precision_focused": "Emphasizes coordinate accuracy",
    "v7_type_focused": "Emphasizes field type selection",
    "v8_confidence_based": "Skip uncertain, high precision",
    "v9_completeness_focused": "Find ALL fields, thorough",
    "v10_balanced": "Middle-ground balanced approach",
}
