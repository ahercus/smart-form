"""
Minimal prompt - From original prototype.
~15 lines, basic field types only (TEXT, CHECKBOX, RADIO, SIGNATURE, DATE).
No special types (table, linkedText, linkedDate).
No rulers or coordinate system guidance.
"""


def build_minimal_prompt() -> str:
    """Build minimal extraction prompt (prototype style)."""
    return """Analyze this form page and identify the exact visual coordinates for user input fields.

CRITICAL RULES FOR BOUNDING BOXES:
1. EXCLUDE LABELS: The bounding box must NOT contain the field label (e.g., "Name:", "Start Time"). It must ONLY contain the empty space/box where the user writes.
2. VISUAL CONTAINERS: Look for empty rectangles, lines (underscores), or table cells.
3. TIGHT FIT: The box should fit tightly around the empty input area.
4. CHECKBOXES/RADIOS: Detect the visual square or circle icon itself.

Return a JSON object with fields array. Each field needs:
- label: string (The text label associated with the field)
- fieldType: One of "text", "checkbox", "radio", "signature", "date"
- coordinates: { left, top, width, height } as percentages 0-100

Return JSON: { "fields": [...], "noFieldsInRegion": false }"""


# Simple field types only
MINIMAL_FIELD_TYPES = ["text", "checkbox", "radio", "signature", "date"]
