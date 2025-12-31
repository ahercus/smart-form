// Prompt templates for Gemini integration

import type { ExtractedField, GeminiMessage } from "../types";
import { formatCharacterLimitsForPrompt } from "../field-dimensions";

/**
 * Build prompt for Gemini Vision to review/QC detected fields
 * The image will have field boxes overlaid showing what Document AI detected
 */
export function buildFieldReviewPrompt(
  pageNumber: number,
  fields: ExtractedField[],
  hasDocumentAIFields: boolean
): string {
  const fieldsJson = fields.length > 0
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
    // QC Mode: Document AI detected fields, Gemini reviews and adjusts
    return `You are reviewing page ${pageNumber} of a PDF form. The image shows the form WITH colored boxes overlaid representing fields detected by Document AI.

## Detected Fields (shown as colored boxes in image)
${fieldsJson}

## Your QC Task
Review the detected field boxes and:
1. **VERIFY** - Are the box positions accurate? Do they cover the actual input areas?
2. **ADJUST** - If a box is misaligned or wrong size, provide corrected coordinates
3. **ADD** - If any fillable fields were MISSED (no box covering them), add them
4. **REMOVE** - If a box covers something that's NOT a fillable field, flag for removal
5. **RECLASSIFY** - If a field type is wrong (e.g., marked as "text" but it's a checkbox), correct it
6. **MERGE TABLE CELLS** - CRITICAL: If you see multiple small boxes inside what should be ONE table cell, REMOVE the small boxes and create ONE properly-sized field per cell

## CRITICAL: Field Positioning for Different Form Styles

Forms use different styles for input areas. Position boxes correctly for each:

### Underline-style fields (most common)
Format: "LABEL: _______________" or "Name ___________"

**KEY INSIGHT**: People write ABOVE underlines, not below them. The underline is a BASELINE.

**CONCRETE EXAMPLE with coordinates:**
If you see a NAME field where the underline is at 27% from top:
- WRONG: top=29% (starts BELOW the line - captures empty space)
- CORRECT: top=24% with height=4% (captures 24-28%, the writing area INCLUDING the line)

The TOP coordinate must be 2-4% HIGHER (smaller number) than the underline position.

Positioning rules:
- Find where the underline IS (e.g., 27% from top)
- Set TOP to 2-4% ABOVE that (e.g., 24% if underline is at 27%)
- Set HEIGHT to 4-5% to capture writing space + underline
- The box should STRADDLE the line, not sit below it

Visual example:
---
LABEL: John Smith          (text written ABOVE the line, at ~25%)
       _______________     (the underline/baseline, at ~27%)
       [  YOUR BOX   ]     WRONG: top=29% misses everything
[      YOUR BOX      ]     CORRECT: top=24%, height=4% captures 24-28%
---

WRONG: If underline is at 27%, placing box at top=29% = empty space
CORRECT: If underline is at 27%, place box at top=24% with height=4%

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

## Color Legend
- Blue boxes = text fields
- Purple boxes = textarea fields
- Amber boxes = date fields
- Green boxes = checkboxes
- Cyan boxes = radio buttons
- Red boxes = signature fields
- Pink boxes = initials fields
- Orange boxes = circle_choice fields
- Gray boxes = unknown type

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

Important: Coordinates are percentages (0-100) relative to page dimensions.
Return ONLY the JSON object, nothing else.`;
  } else {
    // Full Detection Mode: No Document AI fields, Gemini identifies everything
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

Important: Coordinates are percentages (0-100) relative to page dimensions.
Use the grid lines (spaced 10% apart) to estimate positions accurately.
Return ONLY the JSON object, nothing else.`;
  }
}

/**
 * Build prompt for generating questions from finalized fields
 */
export function buildQuestionGenerationPrompt(
  pageNumber: number,
  fields: ExtractedField[],
  conversationHistory: GeminiMessage[],
  contextNotes?: string,
  memoryContext?: string
): string {
  // Include character limits and choice options for each field
  const fieldsWithLimits = fields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.field_type,
    currentValue: f.value || f.ai_suggested_value || null,
    charLimits: formatCharacterLimitsForPrompt(f.coordinates, f.field_type),
    // Include choiceOptions for circle_choice fields so Gemini can populate choices
    ...(f.field_type === "circle_choice" && f.choice_options
      ? { choiceOptions: f.choice_options.map((opt) => opt.label) }
      : {}),
  }));

  const fieldsJson = JSON.stringify(fieldsWithLimits, null, 2);

  const previousQA = conversationHistory
    .filter((m) => m.role === "model")
    .map((m) => m.content)
    .join("\n");

  // Format context notes if provided
  const contextSection = contextNotes?.trim()
    ? `\n## Initial Context From User\nThe user provided the following information when uploading the form:\n"${contextNotes}"\n\nIMPORTANT: Use this context to auto-fill fields where possible. Do NOT ask questions for information already provided here.`
    : "";

  // Format memory context if provided (already formatted by formatMemoriesForPrompt)
  const memorySection = memoryContext?.trim()
    ? `\n${memoryContext}\n\nIMPORTANT: Use the saved memory to auto-fill fields where possible. Do NOT ask questions for information already saved in memory.`
    : "";

  return `You are generating questions for page ${pageNumber} of a PDF form.

## Fields on This Page (already validated)
${fieldsJson}
${contextSection}${memorySection}

## User's Provided Information So Far
${previousQA || "None yet - this is the first page."}

## Your Task
For each field, decide:
1. **SKIP** if the field already has a value
2. **SKIP** if similar information was already asked/provided on a previous page
3. **AUTO-FILL** if you can INFER the answer from information already provided
4. **ASK** only if the field is empty AND you cannot infer the answer

## Core Objective: Minimum User Actions
Complete this form in as few questions as possible:
- Group related fields into single questions (e.g., "What is your full name?" covers first, middle, last name)
- Infer values (if DOB provided, calculate age; if address provided, parse into street/city/state/zip)
- Don't ask twice for the same information even if phrased differently

## CRITICAL: Unambiguous Questions
Forms often collect info about MULTIPLE people (student, parent, emergency contacts, etc.).
Your questions MUST clearly identify WHO the information is about:
- BAD: "What is the name?" (ambiguous - whose name?)
- GOOD: "What is the student's full name?"
- GOOD: "Please provide the Primary Emergency Contact's details"
- GOOD: "What is your (the parent/guardian's) phone number?"

Look at the field labels AND their position on the page to determine which section/person they belong to.
Each question should be completely unambiguous about which entity it's collecting data for.

## CRITICAL: Character Limits
Each field has a "charLimits" property showing MAX and RECOMMENDED character counts.
- NEVER exceed the MAX character limit - text will be clipped and unreadable
- Aim for the RECOMMENDED limit (80% of max) for safety
- For auto-fill values, truncate or abbreviate if needed to fit
- Examples: "Street" → "St.", "Boulevard" → "Blvd.", "Apartment" → "Apt."

## Input Types (ONLY use these exact values for inputType)
- "text": Single-line text input (most common - use for names, addresses, phone numbers, etc.)
- "textarea": Multi-line text for longer responses (comments, descriptions)
- "checkbox": Yes/no questions (single checkbox)
- "date": Date inputs
- "signature": Signature fields (full signature)
- "initials": Initials fields (small boxes for writing initials)
- "circle_choice": For fields with fieldType "circle_choice" - shows all options from the field's choiceOptions
- "memory_choice": Use ONLY when the user's saved memory contains MULTIPLE distinct items that could answer a question (see below)

## Circle-Choice Fields in Questions
When a field has fieldType "circle_choice", use inputType "circle_choice":
- Include a "choices" array with each option from the field's choiceOptions
- Do NOT use "checkbox" for circle_choice fields - that only shows one option
- The choices array should have {label, values} format like memory_choice

Example for a field with choiceOptions [{"label": "Yes"}, {"label": "No"}]:
{
  "question": "Does the student attend KGSC?",
  "fieldIds": ["field-id"],
  "inputType": "circle_choice",
  "choices": [
    { "label": "Yes", "values": { "At KGSC": "Yes" } },
    { "label": "No", "values": { "At KGSC": "No" } }
  ]
}

## Memory-Driven Multiple Choice (memory_choice)
When the user's saved memory contains MULTIPLE distinct items that could answer a question:
- Generate a "memory_choice" question instead of "text"
- Parse the memory text IN CONTEXT of the field labels
- Include a "choices" array with each option's field values pre-extracted
- The UI will automatically add an "Other" option for custom input

When to use memory_choice:
- The saved memory contains 2+ items that match the question type (e.g., 2+ children, 2+ contacts, 2+ addresses)
- The question asks about selecting ONE of those items (e.g., "Which child is this form for?")

Example:
Memory: "Children: Jack (born March 15, 2017, male), Emma (born August 22, 2019, female)"
Fields: [Child First Name, Child DOB, Child Gender]

Generate:
{
  "question": "Which child is this form for?",
  "fieldIds": ["child-first-name-id", "child-dob-id", "child-gender-id"],
  "inputType": "memory_choice",
  "choices": [
    { "label": "Jack", "values": { "Child First Name": "Jack", "Child DOB": "03/15/2017", "Child Gender": "Male" } },
    { "label": "Emma", "values": { "Child First Name": "Emma", "Child DOB": "08/22/2019", "Child Gender": "Female" } }
  ]
}

Rules for memory_choice:
- ONLY use when there are 2+ matching items in memory
- Extract values for ALL linked fields in each choice, not just the identifying field
- Format values appropriately for the field type (dates as MM/DD/YYYY, etc.)
- The "label" should be the most identifiable value (usually the name)
- Use field labels exactly as they appear in the "values" object
- If memory only has 1 matching item, use "text" inputType and auto-fill instead

## IMPORTANT: Inferring Family Last Names
If a family member's memory entry does NOT include an explicit last name, BUT the user's profile has a last name:
- INFER that family members (children, spouse) share the user's last name
- Example: If user's profile shows "Last Name: Hercus" and memory says "Jude - Son - Born: 2022-09-12"
  - Infer Jude's full name is "Jude Hercus"
  - Fill "Last Name" field with "Hercus" for the child
- This inference ONLY applies to immediate family members in the Family category
- If memory explicitly states a different last name, use that instead

## Grouping Multiple Fields
You CAN ask ONE question that fills MULTIPLE fields (even different field types):
- Include ALL relevant field IDs in the "fieldIds" array
- Choose inputType based on how the USER should answer:
  - "text" for short answers (name, single value)
  - "textarea" for complex answers with multiple pieces of info
  - "memory_choice" when user should pick from their saved memories
- The system will parse the user's natural language answer and distribute values to each field

Example: "Provide emergency contact details (name, phone, relationship)"
- fieldIds: [name_field_id, phone_field_id, relationship_field_id]
- inputType: "textarea"
- System parses the answer and fills each field appropriately

## Response Format
Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "What is your full legal name?",
      "fieldIds": ["first-name-field-id", "last-name-field-id"],
      "inputType": "text",
      "profileKey": "legal_name"
    },
    {
      "question": "Which child is this form for?",
      "fieldIds": ["child-first-name-id", "child-dob-id"],
      "inputType": "memory_choice",
      "choices": [
        { "label": "Jack", "values": { "Child First Name": "Jack", "Child DOB": "03/15/2017" } },
        { "label": "Emma", "values": { "Child First Name": "Emma", "Child DOB": "08/22/2019" } }
      ]
    }
  ],
  "autoAnswered": [
    {
      "fieldId": "field-uuid-3",
      "value": "42",
      "reasoning": "User provided DOB 1982-03-15, calculated age"
    }
  ],
  "skippedFields": [
    { "fieldId": "field-uuid-4", "reason": "Already filled: John Smith" }
  ]
}

Note: The "choices" field is ONLY required for "memory_choice" inputType questions.

## Profile Keys (for auto-fill from saved profile)
- legal_name, first_name, last_name, middle_name
- email, phone, mobile_phone
- date_of_birth, age
- street_address, city, state, zip_code, country
- ssn, drivers_license
- employer, job_title
- emergency_contact_name, emergency_contact_phone

Return ONLY the JSON object, nothing else.`;
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

/**
 * Build prompt for parsing a user's natural language answer and distributing
 * the values across multiple related fields
 */
export function buildAnswerParsingPrompt(
  question: string,
  answer: string,
  fields: Array<{ id: string; label: string; fieldType: string }>
): string {
  return `The user answered a form question. Parse their answer and distribute the correct values to each field.

## Question Asked
"${question}"

## User's Answer
"${answer}"

## Fields to Fill
${JSON.stringify(fields, null, 2)}

## Your Task
Parse the user's natural language answer and extract the appropriate value for EACH field based on its label and type.

## Rules
1. Extract only the relevant portion for each field
2. For names: First name = given name only, Last name = family name only
3. For dates: Use the format that fits the field (MM/DD/YYYY for US forms)
4. For pronouns: Extract pronouns like "he/him", "she/her", "they/them"
5. If information for a specific field is not provided, use empty string ""
6. Respect character limits implied by field type (short fields need concise values)

## Formatting (IMPORTANT)
Clean up the user's rough input for professional form output:
- Capitalize names properly: "john smith" → "John Smith"
- Capitalize proper nouns (cities, countries, companies): "new york" → "New York"
- Fix obvious typos if unambiguous
- Remove filler words/phrases not relevant to the field
- Keep addresses, emails, phone numbers in standard formats
- Do NOT add or remove any actual information - only clean up presentation

## CRITICAL: Confidence Check
- Set "confident": true ONLY if you can clearly extract values for the fields
- Set "confident": false if the answer doesn't match the expected fields or is ambiguous
- If not confident, set ALL values to empty strings "" and provide a "warning" message
- NEVER guess or make assumptions - if unsure, mark as not confident

## Response Format
Return ONLY valid JSON:
{
  "confident": true,
  "parsedValues": [
    { "fieldId": "field-id-1", "value": "extracted value for this field" },
    { "fieldId": "field-id-2", "value": "extracted value for this field" }
  ]
}

If NOT confident:
{
  "confident": false,
  "warning": "Brief explanation of why parsing failed (e.g., 'Answer doesn't contain phone number information')",
  "parsedValues": [
    { "fieldId": "field-id-1", "value": "" },
    { "fieldId": "field-id-2", "value": "" }
  ]
}

Example (confident): Answer "John Smith" for fields [First Name, Last Name]:
{
  "confident": true,
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "John" },
    { "fieldId": "last-name-id", "value": "Smith" }
  ]
}

Example (not confident): Answer "yes" for fields [First Name, Last Name, Phone]:
{
  "confident": false,
  "warning": "Answer 'yes' doesn't contain name or phone information",
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "" },
    { "fieldId": "last-name-id", "value": "" },
    { "fieldId": "phone-id", "value": "" }
  ]
}

Return ONLY the JSON object, nothing else.`;
}

/**
 * Build prompt for formatting a single field value
 * Cleans up rough user input without changing the meaning
 */
export function buildSingleFieldFormattingPrompt(
  answer: string,
  field: { label: string; fieldType: string }
): string {
  return `Format this form field value for professional output.

## Field
Label: "${field.label}"
Type: "${field.fieldType}"

## User's Input
"${answer}"

## Formatting Rules
Clean up the user's rough input for a professional form. Apply these rules:
- Capitalize names properly: "john smith" → "John Smith"
- Capitalize proper nouns (cities, countries, companies, schools): "new york" → "New York"
- Fix obvious typos if the correction is unambiguous
- Remove filler words/phrases like "um", "uh", "I think", "probably" etc.
- Format phone numbers consistently: (555) 123-4567
- Keep email addresses lowercase
- Format dates as MM/DD/YYYY for date fields
- NEVER add information that wasn't provided
- NEVER remove meaningful information
- If the input is already well-formatted, return it unchanged

## Response Format
Return ONLY valid JSON:
{
  "value": "formatted value here"
}

Examples:
- Input "john smith" for "First Name" → {"value": "John"}
- Input "my email is bob@test.com" for "Email" → {"value": "bob@test.com"}
- Input "um i live in new york city" for "City" → {"value": "New York City"}
- Input "123 main st" for "Address" → {"value": "123 Main St"}

Return ONLY the JSON object.`;
}

export function buildAnswerReevaluationPrompt(
  newAnswer: { question: string; answer: string },
  pendingQuestions: Array<{ id: string; question: string; fieldIds: string[] }>,
  fields: ExtractedField[]
): string {
  const fieldsMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  // Format pending questions to emphasize the question text
  const formattedPending = pendingQuestions.map((q) => ({
    id: q.id,
    questionText: q.question, // Emphasize this is the key identifier
    targetFields: q.fieldIds.map((id) => fieldsMap[id]?.label).filter(Boolean),
  }));

  return `The user just answered a question. Check if this answer provides EXPLICIT, DIRECT information that can auto-answer other pending questions.

## User's Answer
QUESTION ANSWERED: "${newAnswer.question}"
USER'S RESPONSE: "${newAnswer.answer}"

## Pending Questions (READ THE QUESTION TEXT CAREFULLY)
Each pending question has a "questionText" that specifies EXACTLY what information it's asking for and WHO it's about.

${JSON.stringify(formattedPending, null, 2)}

## CRITICAL RULES - READ CAREFULLY

1. **PAY ATTENTION TO THE QUESTION TEXT - It tells you WHO the data is for**
   - "Student's name" ≠ "Emergency contact's name" ≠ "Parent's name"
   - These are DIFFERENT people even if the field labels are similar ("First Name", "Last Name")
   - The QUESTION TEXT is your primary guide for determining if information matches

2. **ONLY auto-answer when the EXACT information was EXPLICITLY provided for the SAME entity**
   - If user answered about "Secondary Emergency Contact" with "Kerri Hercus"
   - You can ONLY auto-fill other questions about "Secondary Emergency Contact"
   - You CANNOT fill "Student Information", "Primary Emergency Contact", or any other entity

3. **NEVER make inferences across different people/entities**
   - Emergency contact info → CANNOT fill student info
   - Parent info → CANNOT fill child info
   - Primary contact → CANNOT fill secondary contact
   - Each person's information is COMPLETELY SEPARATE

4. **NEVER guess or infer based on relationships**
   - Do NOT assume family members share last names
   - Do NOT assume relationships between people mentioned
   - Do NOT derive one person's info from another person's info
   - The fact that names sound related is NOT a valid reason to auto-fill

5. **When in doubt, DO NOT auto-answer**
   - It's better to ask the user than to fill incorrect data
   - Return an empty array if no CERTAIN matches exist

## Response Format
Return ONLY valid JSON:
{
  "autoAnswer": [
    {
      "questionId": "pending-question-id",
      "answer": "derived answer value",
      "reasoning": "EXPLICIT match: [explain the direct 1:1 correspondence]"
    }
  ]
}

Return an EMPTY array if no questions can be CERTAINLY auto-answered:
{ "autoAnswer": [] }

Return ONLY the JSON object, nothing else.`;
}
