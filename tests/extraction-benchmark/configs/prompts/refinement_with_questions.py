"""
Refinement + Questions prompt.

Second pass that:
1. Reviews and corrects field coordinates from initial extraction
2. Generates user-friendly questions for each field

Similar to what we did with Azure OCR refinement, but for Gemini's own output.
"""


def build_refinement_with_questions_prompt(initial_fields: list[dict]) -> str:
    """
    Build a prompt that refines extracted fields AND generates questions.

    Args:
        initial_fields: The fields from the first extraction pass
    """
    import json
    fields_json = json.dumps(initial_fields, indent=2)

    return f"""FIELD REFINEMENT + QUESTION GENERATION

You are reviewing an initial field extraction from a form. Your tasks:
1. VERIFY and CORRECT the field coordinates
2. GENERATE user-friendly questions for each field

═══════════════════════════════════════════════════════════════════════════════
INITIAL EXTRACTION (to review and refine)
═══════════════════════════════════════════════════════════════════════════════

{fields_json}

═══════════════════════════════════════════════════════════════════════════════
TASK 1: COORDINATE REFINEMENT
═══════════════════════════════════════════════════════════════════════════════

Review each field's coordinates against the actual form image. Fix any issues:

COMMON PROBLEMS TO FIX:
1. Coordinates include the label text (should only cover INPUT AREA)
2. Box is too wide/narrow for the actual input field
3. Box is misaligned (wrong top/left position)
4. Wrong field type (e.g., textarea marked as text, or vice versa)
5. Missing fields that weren't detected
6. Duplicate fields that should be merged

COORDINATE RULES:
- All values are percentages (0-100) of page dimensions
- left: Distance from left edge
- top: Distance from top edge
- width: Width of INPUT AREA only (not label)
- height: Height of INPUT AREA only

SIZING GUIDELINES:
- text (underline): height ~2-3%, width varies
- textarea (box): height ~5-10% (multiple lines)
- checkbox: width ~1.5-2.5%, height ~1-1.5%
- signature: height ~5-8%, width ~25-40%

═══════════════════════════════════════════════════════════════════════════════
TASK 2: QUESTION GENERATION
═══════════════════════════════════════════════════════════════════════════════

For each field, generate a natural question to ask the user:

QUESTION GUIDELINES:
- Be conversational and clear
- Match the field type appropriately
- Help users understand what information is needed
- For checkbox groups, generate ONE question for the group

EXAMPLES:
- "Child's Name" → "What is your child's full name?"
- "D.O.B" → "What is your child's date of birth?"
- Checkbox "Kindergarten" with groupLabel "Pre-Prep experiences" →
  "Which pre-prep experiences has your child had? (Select all that apply)"
- Table "Siblings" → "Please provide details about your child's siblings"
- Textarea "How will child settle?" → "How do you think your child will settle into Prep?"

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return JSON with refined fields, each including a "question" property:

{{
  "fields": [
    {{
      "label": "Field Label",
      "fieldType": "text|textarea|checkbox|date|linkedDate|table|signature",
      "coordinates": {{"left": X, "top": Y, "width": W, "height": H}},
      "question": "User-friendly question for this field",
      "groupLabel": "Optional group context",
      // Include other properties as needed (tableConfig, dateSegments, etc.)
    }}
  ]
}}

IMPORTANT:
- Keep all fields from the original extraction (unless they're duplicates)
- Add any fields that were missed
- Every field MUST have a "question" property
- Coordinates should be refined to be more accurate

Now analyze the image, refine the fields, and generate questions."""
