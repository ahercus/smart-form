"""
Refinement prompt for correcting OCR-detected fields.
Used when Azure Document Intelligence provides initial field detection
that needs coordinate correction, type assignment, and deduplication.
"""


def build_refinement_prompt(ocr_fields: list[dict]) -> str:
    """
    Build a prompt for refining OCR-detected fields.

    Args:
        ocr_fields: List of fields from Azure Document Intelligence

    Returns:
        Prompt string for Gemini refinement
    """

    # Format the OCR fields as JSON for the prompt
    import json
    fields_json = json.dumps(ocr_fields, indent=2)

    return f"""You are refining form field detection from an OCR system.

## Context
An OCR system scanned this form page and detected the fields listed below. However, the OCR made several errors:
- **Coordinates are wrong**: Bounding boxes often include the label text instead of just the empty input area
- **Field types are incorrect**: Most fields are marked as "text" but may be checkbox, table, textarea, linkedDate, etc.
- **Duplicates exist**: Some fields appear multiple times (especially table cells that should be one table)
- **Fields may be missing**: The OCR might have missed some input areas

## Your Task
Review the image and the OCR output below. Return a corrected list of fields with:

1. **Fixed coordinates**: Bounding boxes should cover ONLY the empty input area where users write, NOT the label
2. **Correct field types**: Use the appropriate type for each field:
   - `text`: Single-line text input (underline or box)
   - `textarea`: Multi-line text area (tall box, 3+ lines)
   - `checkbox`: Small square for checking
   - `date`: Simple date field
   - `linkedDate`: Date with separate day/month/year segments (include dateSegments array)
   - `table`: Grid of cells (include tableConfig with columnHeaders, coordinates, dataRows)
   - `signature`: Signature box
3. **Deduplicated**: If the OCR detected table cells individually, combine them into one table field
4. **Complete**: Add any fields the OCR missed

## OCR Detection Results
```json
{fields_json}
```

## Coordinate Rules
- All coordinates are percentages (0-100) of the page dimensions
- `left`: Distance from left edge
- `top`: Distance from top edge
- `width`: Width of input area only
- `height`: Height of input area only

## Response Format
Return JSON with:
```json
{{
  "fields": [
    {{
      "label": "Field Label",
      "fieldType": "text|textarea|checkbox|date|linkedDate|table|signature",
      "coordinates": {{"left": X, "top": Y, "width": W, "height": H}},
      "groupLabel": "Optional section name"
    }}
  ],
  "refinement_notes": "Brief summary of what you changed"
}}
```

For linkedDate fields, include:
```json
{{
  "label": "D.O.B",
  "fieldType": "linkedDate",
  "dateSegments": [
    {{"left": X, "top": Y, "width": W, "height": H, "part": "day"}},
    {{"left": X, "top": Y, "width": W, "height": H, "part": "month"}},
    {{"left": X, "top": Y, "width": W, "height": H, "part": "year"}}
  ]
}}
```

For table fields, include:
```json
{{
  "label": "Table Label",
  "fieldType": "table",
  "tableConfig": {{
    "columnHeaders": ["Col1", "Col2", ...],
    "coordinates": {{"left": X, "top": Y, "width": W, "height": H}},
    "dataRows": 4,
    "columnPositions": [0, 25, 50, 75, 100]
  }}
}}
```

Now analyze the image and refine the OCR results."""


def build_refinement_prompt_minimal(ocr_fields: list[dict]) -> str:
    """Minimal version of refinement prompt."""
    import json
    fields_json = json.dumps(ocr_fields, indent=2)

    return f"""OCR detected these fields but made errors. Fix them:

1. Coordinates should cover input area only, not labels
2. Assign correct field types (text, textarea, checkbox, linkedDate, table, signature)
3. Combine duplicate table cells into one table field
4. Add any missing fields

OCR output:
```json
{fields_json}
```

Return corrected JSON with fields array."""
