import type { ExtractedField, GeminiMessage } from "../../types";
import { formatCharacterLimitsForPrompt } from "../../field-dimensions";

export function buildQuestionGenerationPrompt(
  pageNumber: number,
  fields: ExtractedField[],
  conversationHistory: GeminiMessage[],
  contextNotes?: string,
  memoryContext?: string
): string {
  const fieldsWithLimits = fields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.field_type,
    currentValue: f.value || f.ai_suggested_value || null,
    charLimits: formatCharacterLimitsForPrompt(f.coordinates, f.field_type),
    ...(f.field_type === "circle_choice" && f.choice_options
      ? { choiceOptions: f.choice_options.map((opt) => opt.label) }
      : {}),
  }));

  const fieldsJson = JSON.stringify(fieldsWithLimits, null, 2);

  const previousQA = conversationHistory
    .filter((m) => m.role === "model")
    .map((m) => m.content)
    .join("\n");

  const contextSection = contextNotes?.trim()
    ? `\n## Initial Context From User\nThe user provided the following information when uploading the form:\n"${contextNotes}"\n\nIMPORTANT: Use this context to auto-fill fields where possible. Do NOT ask questions for information already provided here.`
    : "";

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
