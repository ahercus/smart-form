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

## Color Legend
- Blue boxes = text fields
- Purple boxes = textarea fields
- Amber boxes = date fields
- Green boxes = checkboxes
- Cyan boxes = radio buttons
- Red boxes = signature fields
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
- signature: Signature lines or boxes

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
  contextNotes?: string
): string {
  // Include character limits for each field
  const fieldsWithLimits = fields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.field_type,
    currentValue: f.value || f.ai_suggested_value || null,
    charLimits: formatCharacterLimitsForPrompt(f.coordinates, f.field_type),
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

  return `You are generating questions for page ${pageNumber} of a PDF form.

## Fields on This Page (already validated)
${fieldsJson}
${contextSection}

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

## CRITICAL: Character Limits
Each field has a "charLimits" property showing MAX and RECOMMENDED character counts.
- NEVER exceed the MAX character limit - text will be clipped and unreadable
- Aim for the RECOMMENDED limit (80% of max) for safety
- For auto-fill values, truncate or abbreviate if needed to fit
- Examples: "Street" → "St.", "Boulevard" → "Blvd.", "Apartment" → "Apt."

## Response Format
Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "What is your full legal name?",
      "fieldIds": ["field-uuid-1", "field-uuid-2"],
      "inputType": "text",
      "profileKey": "legal_name"
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

## Response Format
Return ONLY valid JSON:
{
  "parsedValues": [
    { "fieldId": "field-id-1", "value": "extracted value for this field" },
    { "fieldId": "field-id-2", "value": "extracted value for this field" }
  ]
}

Example: If answer is "John Michael Smith, born 03/15/1990, he/him" for fields [First Name, Last Name, DOB, Pronouns]:
{
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "John" },
    { "fieldId": "last-name-id", "value": "Smith" },
    { "fieldId": "dob-id", "value": "03/15/1990" },
    { "fieldId": "pronouns-id", "value": "he/him" }
  ]
}

Return ONLY the JSON object, nothing else.`;
}

export function buildAnswerReevaluationPrompt(
  newAnswer: { question: string; answer: string },
  pendingQuestions: Array<{ id: string; question: string; fieldIds: string[] }>,
  fields: ExtractedField[]
): string {
  const fieldsMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  const pendingWithFields = pendingQuestions.map((q) => ({
    ...q,
    relatedFields: q.fieldIds.map((id) => fieldsMap[id]?.label).filter(Boolean),
  }));

  return `The user just answered a question. Check if this answer provides enough information to auto-answer other pending questions.

## New Answer
Question: "${newAnswer.question}"
Answer: "${newAnswer.answer}"

## Pending Questions
${JSON.stringify(pendingWithFields, null, 2)}

## Your Task
Determine if the new answer contains information that can auto-fill any pending questions.

## Response Format
Return ONLY valid JSON:
{
  "autoAnswer": [
    {
      "questionId": "pending-question-id",
      "answer": "derived answer value",
      "reasoning": "How this was inferred from the new answer"
    }
  ]
}

Return ONLY the JSON object, nothing else.`;
}
