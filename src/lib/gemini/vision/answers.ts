import { getFastModel } from "../client";
import { buildAnswerParsingPrompt, buildSingleFieldFormattingPrompt, buildAnswerReevaluationPrompt } from "../prompts/answers";
import { answerParsingSchema } from "../schemas";
import type { ExtractedField } from "../../types";

export interface ParsedFieldValue {
  fieldId: string;
  value: string;
}

export interface ParseAnswerResult {
  confident: boolean;
  warning?: string;
  parsedValues: ParsedFieldValue[];
  missingFields?: string[];
  followUpQuestion?: string;
}

interface ChoiceOption {
  label: string;
  coordinates?: { left: number; top: number; width: number; height: number };
}

interface ParseAnswerParams {
  question: string;
  answer: string;
  fields: Array<{
    id: string;
    label: string;
    fieldType: string;
    choiceOptions?: ChoiceOption[];
  }>;
}

export async function parseAnswerForFields(
  params: ParseAnswerParams
): Promise<ParseAnswerResult> {
  const { question, answer, fields } = params;

  if (fields.length === 1) {
    const field = fields[0];

    // Handle data URIs (signatures, etc.) directly
    if (answer.startsWith("data:")) {
      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: answer }],
      };
    }

    // Handle circle_choice fields: match answer to valid options directly, no Gemini needed
    if (field.fieldType === "circle_choice" && field.choiceOptions?.length) {
      const options = field.choiceOptions;
      const answerLower = answer.toLowerCase().trim();

      // Find exact or case-insensitive match
      const exactMatch = options.find((opt) => opt.label === answer);
      const caseInsensitiveMatch = options.find(
        (opt) => opt.label.toLowerCase() === answerLower
      );

      const matchedOption = exactMatch || caseInsensitiveMatch;

      if (matchedOption) {
        console.log("[AutoForm] Circle choice matched:", {
          fieldLabel: field.label,
          input: answer,
          matched: matchedOption.label,
        });
        return {
          confident: true,
          parsedValues: [{ fieldId: field.id, value: matchedOption.label }],
        };
      }

      // No match found - return as not confident
      console.log("[AutoForm] Circle choice no match:", {
        fieldLabel: field.label,
        input: answer,
        validOptions: options.map((o) => o.label),
      });
      return {
        confident: false,
        warning: `Please select one of: ${options.map((o) => o.label).join(", ")}`,
        parsedValues: [{ fieldId: field.id, value: "" }],
        missingFields: [field.id],
      };
    }

    try {
      const model = getFastModel();
      const prompt = buildSingleFieldFormattingPrompt(answer, {
        label: field.label,
        fieldType: field.fieldType,
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      let cleaned = text.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);

      const parsed = JSON.parse(cleaned.trim());
      const formattedValue = parsed.value ?? answer;

      console.log("[AutoForm] Single field formatted:", {
        fieldLabel: field.label,
        input: answer.slice(0, 30),
        output: formattedValue.slice(0, 30),
      });

      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: formattedValue }],
      };
    } catch (error) {
      console.error("[AutoForm] Single field formatting failed:", error);
      return {
        confident: true,
        parsedValues: [{ fieldId: field.id, value: answer }],
      };
    }
  }

  console.log("[AutoForm] Parsing answer for multiple fields:", {
    question: question.slice(0, 50),
    answer: answer.slice(0, 50),
    fieldCount: fields.length,
    fieldLabels: fields.map((f) => f.label),
  });

  try {
    const model = getFastModel(answerParsingSchema);
    const prompt = buildAnswerParsingPrompt(question, answer, fields);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }

    const parsed = JSON.parse(cleaned.trim());
    const confident = parsed.confident !== false;
    const warning = parsed.warning;
    const parsedValues = parsed.parsedValues || [];
    const missingFields = parsed.missingFields || [];
    const followUpQuestion = parsed.followUpQuestion;

    // Post-process: normalize circle_choice values to match exact option labels
    const normalizedValues = parsedValues.map((pv: ParsedFieldValue) => {
      const field = fields.find((f) => f.id === pv.fieldId);
      if (field?.fieldType === "circle_choice" && field.choiceOptions?.length && pv.value) {
        const options = field.choiceOptions;
        const valueLower = pv.value.toLowerCase().trim();
        const match = options.find((opt) => opt.label.toLowerCase() === valueLower);
        if (match) {
          return { ...pv, value: match.label };
        }
      }
      return pv;
    });

    console.log("[AutoForm] Answer parsed:", {
      confident,
      warning,
      inputAnswer: answer,
      outputFields: normalizedValues.length,
      missingFieldCount: missingFields.length,
      hasFollowUp: !!followUpQuestion,
      values: normalizedValues.map((v: ParsedFieldValue) => ({
        label: fields.find((f) => f.id === v.fieldId)?.label,
        value: v.value?.slice(0, 20) || "",
      })),
    });

    return { confident, warning, parsedValues: normalizedValues, missingFields, followUpQuestion };
  } catch (error) {
    console.error("[AutoForm] Answer parsing failed:", error);
    return {
      confident: false,
      warning: "Failed to parse answer. Please try rephrasing.",
      parsedValues: fields.map((f) => ({ fieldId: f.id, value: "" })),
      missingFields: fields.map((f) => f.id),
    };
  }
}

interface ReevaluateParams {
  newAnswer: { question: string; answer: string };
  pendingQuestions: Array<{ id: string; question: string; fieldIds: string[] }>;
  fields: ExtractedField[];
}

export async function reevaluatePendingQuestions(
  params: ReevaluateParams
): Promise<Array<{ questionId: string; answer: string; reasoning: string }>> {
  const { newAnswer, pendingQuestions, fields } = params;

  if (pendingQuestions.length === 0) {
    return [];
  }

  console.log("[AutoForm] Re-evaluating pending questions after new answer:", {
    newQuestion: newAnswer.question,
    pendingCount: pendingQuestions.length,
  });

  const model = getFastModel();

  const prompt = buildAnswerReevaluationPrompt(newAnswer, pendingQuestions, fields);

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  try {
    const parsed = JSON.parse(cleaned.trim());
    return parsed.autoAnswer || [];
  } catch {
    console.error("[AutoForm] Failed to parse reevaluation response");
    return [];
  }
}
