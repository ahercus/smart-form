"""
High Agency prompt - Trust the model, minimal guidance.
~25 lines. Includes textarea. Uses "common sense" philosophy.
References rulers but doesn't over-explain.
"""


def build_high_agency_prompt(quadrant: int | None = None) -> str:
    """
    Build high agency extraction prompt.

    Args:
        quadrant: Optional quadrant number (1-4) for quadrant mode.
                  None for single-page mode.
    """
    quadrant_instruction = ""
    if quadrant:
        ranges = {1: (0, 25), 2: (25, 50), 3: (50, 75), 4: (75, 100)}
        top, bottom = ranges[quadrant]
        quadrant_instruction = f"""
FOCUS AREA: Only extract fields in the PURPLE HIGHLIGHTED REGION ({top}%-{bottom}% vertically).
If a field crosses the top boundary, skip it. If it crosses the bottom, include it fully.
"""

    return f"""Extract all fillable input fields from this form page.

COORDINATES: Use percentages (0-100) based on the ruler margins.
{quadrant_instruction}
Return JSON with fields array. Each field needs:
- label: what the field is for
- fieldType: text, textarea, checkbox, date, signature, table, linkedDate
- coordinates: {{left, top, width, height}} as percentages

Guidelines:
- Box = only the empty input area, not the label
- Checkboxes are small squares (~2-3%)
- Tables need tableConfig with columnHeaders, coordinates, dataRows
- Segmented dates (day/month/year boxes) use linkedDate with dateSegments
- Use common sense for ambiguous cases

Focus on accuracy over completeness.

Return: {{ "fields": [...], "noFieldsInRegion": false }}"""


# Field types supported
HIGH_AGENCY_FIELD_TYPES = [
    "text", "textarea", "checkbox", "date",
    "signature", "table", "linkedDate"
]
