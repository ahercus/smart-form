/**
 * Document-wide question generation prompt
 *
 * This prompt generates questions for an ENTIRE document at once,
 * with full awareness of:
 * - All fields across all pages
 * - Full document text (OCR)
 * - User's saved memory context
 *
 * Key capabilities:
 * - Entity detection (Student, Parent 1, Parent 2, Emergency Contact, etc.)
 * - Cross-page field grouping
 * - Intelligent question consolidation
 * - Memory-driven auto-fill and choice generation
 */

import type { ExtractedField, MemoryChoice } from "../../types";
import { formatCharacterLimitsForPrompt } from "../../field-dimensions";

interface DocumentQuestionsParams {
  fields: ExtractedField[];
  ocrText: string;
  memoryContext: string;
  contextNotes?: string;
  clientDateTime?: string;
  clientTimeZone?: string;
  clientTimeZoneOffsetMinutes?: number;
}

export function buildDocumentQuestionsPrompt(params: DocumentQuestionsParams): string {
  const {
    fields,
    ocrText,
    memoryContext,
    contextNotes,
    clientDateTime,
    clientTimeZone,
    clientTimeZoneOffsetMinutes,
  } = params;

  // Group fields by page for structured output
  const fieldsByPage = new Map<number, typeof fields>();
  for (const field of fields) {
    const pageFields = fieldsByPage.get(field.page_number) || [];
    pageFields.push(field);
    fieldsByPage.set(field.page_number, pageFields);
  }

  // Format fields with page grouping
  const fieldsJson = JSON.stringify(
    Array.from(fieldsByPage.entries()).map(([page, pageFields]) => ({
      page,
      fields: pageFields.map((f) => ({
        id: f.id,
        label: f.label,
        fieldType: f.field_type,
        groupLabel: f.group_label,
        currentValue: f.value || f.ai_suggested_value || null,
        charLimits: formatCharacterLimitsForPrompt(f.coordinates, f.field_type),
        ...(f.field_type === "circle_choice" && f.choice_options
          ? { choiceOptions: f.choice_options.map((opt) => opt.label) }
          : {}),
      })),
    })),
    null,
    2
  );

  const contextSection = contextNotes?.trim()
    ? `
## User-Provided Context
The user said: "${contextNotes}"
Use this to auto-fill fields where possible. Do NOT ask for information already provided.`
    : "";

  const memorySection = memoryContext?.trim()
    ? `
${memoryContext}

Use saved memory to auto-fill fields. Do NOT ask for information already in memory.`
    : "";

  const timeSection = clientDateTime
    ? `
## Current Client Date/Time
Local time: ${clientDateTime}${clientTimeZone ? `\nTime zone: ${clientTimeZone}` : ""}${clientTimeZoneOffsetMinutes !== undefined ? `\nUTC offset (minutes): ${clientTimeZoneOffsetMinutes}` : ""}

Use this when fields ask for "today", "current date", or relative dates.`
    : "";

  // Truncate OCR text if too long (keep first 15000 chars)
  const truncatedOcr = ocrText.length > 15000
    ? ocrText.slice(0, 15000) + "\n...[truncated]..."
    : ocrText;

  return `You are generating questions for a PDF form. You have FULL DOCUMENT CONTEXT.

═══════════════════════════════════════════════════════════════════════════════
DOCUMENT TEXT (OCR)
═══════════════════════════════════════════════════════════════════════════════
${truncatedOcr || "No OCR text available."}

═══════════════════════════════════════════════════════════════════════════════
ALL FORM FIELDS (by page)
═══════════════════════════════════════════════════════════════════════════════
${fieldsJson}
${contextSection}${memorySection}${timeSection}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK: ENTITY DETECTION & QUESTION GENERATION
═══════════════════════════════════════════════════════════════════════════════

STEP 1: IDENTIFY ENTITIES
Scan the document and identify distinct entities being collected:
- Student/Child (the primary subject)
- Parent/Guardian 1
- Parent/Guardian 2
- Emergency Contact 1, 2, 3...
- Doctor/Physician
- Employer
- etc.

Each entity may have fields spread across MULTIPLE pages.

STEP 2: MAP FIELDS TO ENTITIES
Assign each field to its entity based on:
- Section headings in the OCR text
- Field labels and groupLabel
- Position on the page (grouped fields usually belong together)
- Common patterns (e.g., "Mother's Name" → Parent 1 entity)

STEP 3: GENERATE CONSOLIDATED QUESTIONS
For each entity, generate ONE question that covers ALL its fields across ALL pages:
- "Which child is this enrollment for?" → fills Student Name, DOB, Gender across pages 1, 2, 3
- "Parent/Guardian 1 details?" → fills all Parent 1 fields across the document
- etc.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════════════════════

1. CROSS-PAGE GROUPING
   A single question can fill fields from ANY page. Include all relevant fieldIds.

2. MINIMUM QUESTIONS
   Combine aggressively. Aim for 5-10 questions total, not one per field.

3. UNAMBIGUOUS QUESTIONS
   BAD: "What is the name?" (whose?)
   GOOD: "What is the student's full name?"
   GOOD: "Parent/Guardian 1 contact details (name, phone, relationship)"

4. MEMORY-DRIVEN CHOICES
   If memory has 2+ matching items (e.g., 2 children), use "memory_choice":
   - Parse values for ALL linked fields across the document
   - Include fieldIds from every page that relates to that entity

5. AUTO-FILL FROM MEMORY
   If memory has exactly 1 matching item, auto-fill those fields instead.

6. CHARACTER LIMITS
   Each field has charLimits. Never exceed MAX. Abbreviate if needed.

═══════════════════════════════════════════════════════════════════════════════
INPUT TYPES
═══════════════════════════════════════════════════════════════════════════════

- "text": Single-line input (names, phone numbers, etc.)
- "textarea": Multi-line input (addresses, descriptions)
- "checkbox": Yes/no toggle
- "date": Date picker
- "signature": Signature field
- "initials": Initials field
- "circle_choice": Field with predefined options (use choices from field's choiceOptions)
- "memory_choice": When user must pick from 2+ saved memory items

═══════════════════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON:

{
  "entities": [
    {
      "id": "student",
      "label": "Student",
      "description": "The child being enrolled",
      "fieldIds": ["f1", "f5", "f12", "f28", "f45"]
    },
    {
      "id": "parent1",
      "label": "Parent/Guardian 1",
      "description": "Primary parent or guardian",
      "fieldIds": ["f2", "f6", "f13", "f30"]
    }
  ],
  "questions": [
    {
      "question": "Which child is this form for?",
      "entityId": "student",
      "fieldIds": ["f1", "f5", "f12", "f28", "f45"],
      "inputType": "memory_choice",
      "choices": [
        {
          "label": "Jude",
          "values": {
            "Student First Name": "Jude",
            "Student Last Name": "Hercus",
            "Date of Birth": "09/12/2022",
            "Gender": "Male"
          }
        }
      ]
    },
    {
      "question": "Parent/Guardian 1 details (name, phone, email)",
      "entityId": "parent1",
      "fieldIds": ["f2", "f6", "f13", "f30"],
      "inputType": "textarea"
    }
  ],
  "autoAnswered": [
    {
      "fieldId": "f99",
      "value": "123 Main St",
      "reasoning": "Inferred from memory: home address"
    }
  ],
  "skippedFields": [
    {
      "fieldId": "f50",
      "reason": "Already filled: John Smith"
    }
  ]
}

NOTES:
- "entities" documents what you detected (for debugging/transparency)
- "questions" is the actual output - each links to an entityId and includes ALL fieldIds for that entity
- "choices" only required for "memory_choice" inputType
- Include fieldIds from ANY page in a single question
- Use field labels exactly in the "values" object for memory_choice

Return ONLY the JSON object, nothing else.`;
}

// Response schema for structured output
export const DOCUMENT_QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          fieldIds: { type: "array", items: { type: "string" } },
        },
        required: ["id", "label", "fieldIds"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          entityId: { type: "string" },
          fieldIds: { type: "array", items: { type: "string" } },
          inputType: { type: "string" },
          profileKey: { type: "string" },
          choices: { type: "array" },
        },
        required: ["question", "fieldIds", "inputType"],
      },
    },
    autoAnswered: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string" },
          value: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["fieldId", "value"],
      },
    },
    skippedFields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["fieldId", "reason"],
      },
    },
  },
  required: ["entities", "questions", "autoAnswered", "skippedFields"],
};
