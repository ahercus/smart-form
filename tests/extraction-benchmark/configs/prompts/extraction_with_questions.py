"""
Combined extraction + question generation prompt.
Single call to extract fields AND generate wizard questions.
"""


def build_extraction_with_questions_prompt() -> str:
    """
    Build a prompt that extracts fields AND generates questions in one call.
    Replaces the need for separate quadrant extraction + consolidation passes.
    """
    return """Analyze this form page and extract all fillable input fields, then generate user-friendly questions for each field.

## TASK 1: Field Extraction

Identify all input fields where users write/select. For each field provide:
- `label`: The field's label text
- `fieldType`: One of: text, textarea, checkbox, date, linkedDate, table, signature
- `coordinates`: Bounding box as percentages (0-100) of page dimensions
  - `left`: Distance from left edge
  - `top`: Distance from top edge
  - `width`: Width of INPUT AREA only (not label)
  - `height`: Height of INPUT AREA only

### Field Type Guidelines

**text**: Single-line input (underline or small box). Width typically 20-50%, height ~2%.

**textarea**: Multi-line text area (tall box, 3+ lines). Height typically 5-10%.

**checkbox**: Small square (~1.5% × 1.2%). Include `groupLabel` if part of a set.

**linkedDate**: Date with separate day/month/year segments. Include `dateSegments` array:
```json
{
  "label": "D.O.B",
  "fieldType": "linkedDate",
  "dateSegments": [
    {"left": X, "top": Y, "width": W, "height": H, "part": "day"},
    {"left": X, "top": Y, "width": W, "height": H, "part": "month"},
    {"left": X, "top": Y, "width": W, "height": H, "part": "year"}
  ]
}
```

**table**: Grid with multiple rows/columns. Include `tableConfig`:
```json
{
  "label": "Table Label",
  "fieldType": "table",
  "tableConfig": {
    "columnHeaders": ["Col1", "Col2"],
    "coordinates": {"left": X, "top": Y, "width": W, "height": H},
    "dataRows": 4,
    "columnPositions": [0, 50, 100]
  }
}
```

### Critical Rules
1. Bounding boxes cover INPUT AREA only - never include label text
2. Coordinates are percentages (0-100) of page dimensions
3. Tables are ONE field, not individual cells
4. Checkboxes in a group share the same `groupLabel`

## TASK 2: Question Generation

For each extracted field, generate a natural question to ask the user. Questions should:
- Be conversational and clear
- Match the field type (e.g., "Select all that apply" for checkbox groups)
- Help users understand what information is needed

### Question Format
Add a `question` field to each extracted field:
```json
{
  "label": "Child's Name",
  "fieldType": "text",
  "coordinates": {...},
  "question": "What is your child's full name?"
}
```

For checkbox groups, generate ONE question for the group:
```json
{
  "label": "Kindergarten",
  "fieldType": "checkbox",
  "groupLabel": "Pre-Prep experiences",
  "question": "Which pre-prep experiences has your child had? (Select all that apply)"
}
```

For tables, generate a question about the table's purpose:
```json
{
  "label": "Siblings",
  "fieldType": "table",
  "tableConfig": {...},
  "question": "Please provide details about your child's siblings"
}
```

## Response Format

Return JSON:
```json
{
  "fields": [
    {
      "label": "Field Label",
      "fieldType": "text|textarea|checkbox|date|linkedDate|table|signature",
      "coordinates": {"left": X, "top": Y, "width": W, "height": H},
      "question": "User-friendly question for this field",
      "groupLabel": "Optional group name for checkboxes"
    }
  ]
}
```

Now analyze the image and extract all fields with their questions."""
