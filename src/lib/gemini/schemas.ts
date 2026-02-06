// Structured output schemas for Gemini API
// These constrain Gemini's responses to ONLY allowed values - no inventing new types

/**
 * Allowed field types for PDF field detection (Gemini QC)
 * These are types that can be detected ON the PDF
 *
 * If you need to add a new type, also update:
 * - Database constraint (extracted_fields.field_type_check)
 * - CLAUDE.md documentation
 */
export const ALLOWED_FIELD_TYPES = [
  "text",
  "textarea",
  "checkbox",
  "radio",
  "date",
  "signature",
  "initials",
  "circle_choice", // For fields where user circles one of several printed options
  "unknown",
] as const;

export type AllowedFieldType = typeof ALLOWED_FIELD_TYPES[number];

/**
 * Allowed input types for wizard questions
 * Includes all field types PLUS memory_choice (wizard-only, not a PDF field type)
 *
 * memory_choice: Used when user has multiple saved items (e.g., children) and picks one
 */
export const ALLOWED_INPUT_TYPES = [
  ...ALLOWED_FIELD_TYPES,
  "memory_choice", // Wizard-only: pick from saved memories
] as const;

export type AllowedInputType = typeof ALLOWED_INPUT_TYPES[number];

/**
 * Coordinates schema - percentages (0-100) relative to page
 */
const coordinatesSchema = {
  type: "object",
  properties: {
    left: { type: "number", description: "Left position as percentage (0-100)" },
    top: { type: "number", description: "Top position as percentage (0-100)" },
    width: { type: "number", description: "Width as percentage (0-100)" },
    height: { type: "number", description: "Height as percentage (0-100)" },
  },
  required: ["left", "top", "width", "height"],
};

/**
 * Schema for field review/QC responses
 * Constrains fieldType to ONLY allowed values
 */
export const fieldReviewSchema = {
  type: "object",
  properties: {
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string", description: "ID of field to adjust" },
          action: { type: "string", enum: ["update"] },
          changes: {
            type: "object",
            properties: {
              label: { type: "string" },
              fieldType: {
                type: "string",
                enum: ALLOWED_FIELD_TYPES,
                description: "Field type - MUST be one of the allowed values"
              },
              coordinates: coordinatesSchema,
            },
          },
        },
        required: ["fieldId", "action"],
      },
    },
    newFields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Label for the field" },
          fieldType: {
            type: "string",
            enum: ALLOWED_FIELD_TYPES,
            description: "Field type - MUST be one of the allowed values"
          },
          coordinates: coordinatesSchema,
        },
        required: ["label", "fieldType", "coordinates"],
      },
    },
    removeFields: {
      type: "array",
      items: { type: "string" },
      description: "Array of field IDs to remove",
    },
    fieldsValidated: {
      type: "boolean",
      description: "Whether field validation was successful",
    },
  },
  required: ["adjustments", "newFields", "removeFields", "fieldsValidated"],
  propertyOrdering: ["adjustments", "newFields", "removeFields", "fieldsValidated"],
};

/**
 * Schema for question generation responses
 */
export const questionGenerationSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask the user" },
          fieldIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of fields this question fills"
          },
          inputType: {
            type: "string",
            enum: ALLOWED_INPUT_TYPES,
            description: "Input type for the question"
          },
          profileKey: { type: "string", description: "Optional profile key for auto-fill" },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                values: { type: "object" },
              },
            },
            description: "Optional choices for memory-based questions"
          },
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
          reason: { type: "string" },
        },
        required: ["fieldId", "value", "reason"],
      },
    },
    skippedFields: {
      type: "array",
      items: { type: "string" },
      description: "Field IDs that were skipped",
    },
  },
  required: ["questions", "autoAnswered", "skippedFields"],
  propertyOrdering: ["questions", "autoAnswered", "skippedFields"],
};

/**
 * Schema for answer parsing responses
 */
export const answerParsingSchema = {
  type: "object",
  properties: {
    confident: {
      type: "boolean",
      description: "Whether the parsing was confident"
    },
    warning: {
      type: "string",
      description: "Optional warning message"
    },
    parsedValues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string" },
          value: { type: "string" },
        },
        required: ["fieldId", "value"],
      },
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
      description: "Field IDs that still need values",
    },
    followUpQuestion: {
      type: "string",
      description: "Optional follow-up question for missing fields",
    },
  },
  required: ["confident", "parsedValues"],
  propertyOrdering: ["confident", "warning", "parsedValues", "missingFields", "followUpQuestion"],
};
