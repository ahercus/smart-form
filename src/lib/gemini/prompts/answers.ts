import type { ExtractedField } from "../../types";

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

## CRITICAL: Partial Fill Support
- Fill what you CAN confidently extract, leave empty what you CANNOT
- Set "confident": true if you can extract AT LEAST ONE field value
- Set "confident": false ONLY if the answer is completely irrelevant to ALL fields
- For partially provided information, fill the fields you can and leave others empty
- The "missingFields" array should list field IDs that still need values

## Follow-up Question (IMPORTANT)
When generating a followUpQuestion for partial answers:
- Be direct and efficient - no "Can you please provide" or other filler
- If relevant, incorporate extracted values (like names) to give context
- Example: If you extracted "Kate Mikes" as the name and still need email/phone:
  - GOOD: "What is Kate Mikes' email and phone number?"
  - BAD: "Can you please provide Kate Mikes' email address and phone number?"
- Only reference extracted values when it helps clarify whose information is needed

## Response Format
Return ONLY valid JSON:
{
  "confident": true,
  "parsedValues": [
    { "fieldId": "field-id-1", "value": "extracted value for this field" },
    { "fieldId": "field-id-2", "value": "" }
  ],
  "missingFields": ["field-id-2"],
  "followUpQuestion": "What is the last name?"
}

If completely irrelevant answer (CANNOT extract anything):
{
  "confident": false,
  "warning": "Brief explanation of why parsing failed (e.g., 'Answer doesn't relate to the requested information')",
  "parsedValues": [
    { "fieldId": "field-id-1", "value": "" },
    { "fieldId": "field-id-2", "value": "" }
  ],
  "missingFields": ["field-id-1", "field-id-2"]
}

Example (full answer): Answer "John Smith" for fields [First Name, Last Name]:
{
  "confident": true,
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "John" },
    { "fieldId": "last-name-id", "value": "Smith" }
  ],
  "missingFields": []
}

Example (partial answer): Answer "John" for fields [First Name, Last Name, Phone]:
{
  "confident": true,
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "John" },
    { "fieldId": "last-name-id", "value": "" },
    { "fieldId": "phone-id", "value": "" }
  ],
  "missingFields": ["last-name-id", "phone-id"],
  "followUpQuestion": "What is John's last name and phone number?"
}

Example (irrelevant answer): Answer "yes" for fields [First Name, Last Name, Phone]:
{
  "confident": false,
  "warning": "Answer 'yes' doesn't contain name or phone information",
  "parsedValues": [
    { "fieldId": "first-name-id", "value": "" },
    { "fieldId": "last-name-id", "value": "" },
    { "fieldId": "phone-id", "value": "" }
  ],
  "missingFields": ["first-name-id", "last-name-id", "phone-id"]
}

Return ONLY the JSON object, nothing else.`;
}

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
  const formattedPending = pendingQuestions.map((q) => ({
    id: q.id,
    questionText: q.question,
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
