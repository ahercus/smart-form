/**
 * Quick context scan using Gemini Vision
 *
 * A lightweight, fast scan of the page to determine:
 * - Form type (e.g., "school enrollment", "medical history")
 * - Form subject (e.g., "student", "patient", "employee")
 *
 * This runs in parallel with quadrant extraction to provide context
 * without adding latency to the critical path.
 */

import { generateWithVisionFast } from "../client";

/**
 * Result from context scan
 */
export interface ContextScanResult {
  formType: string;
  formSubject: string;
  durationMs: number;
}

/**
 * Build prompt for context scan
 */
function buildContextScanPrompt(): string {
  return `You are quickly scanning a PDF form page to understand its context.

## Your Task
Look at this form page and identify:

1. **Form Type**: What kind of form is this?
   - Examples: "school enrollment", "medical history", "job application", "tax form", "insurance claim", "permission slip", "registration form"

2. **Form Subject**: Who is this form primarily about?
   - Examples: "student", "patient", "employee", "applicant", "child", "member", "customer"
   - If the form is about the person filling it out, use "self"
   - If there are multiple subjects (e.g., parent filling out for child), identify the PRIMARY subject

## Response Format
Return ONLY valid JSON:
{
  "formType": "school enrollment",
  "formSubject": "student"
}

Keep your response concise. Return ONLY the JSON object, nothing else.`;
}

/**
 * Schema for context scan response
 */
const contextScanSchema = {
  type: "object",
  properties: {
    formType: {
      type: "string",
      description: "Type of form (e.g., 'school enrollment', 'medical history')",
    },
    formSubject: {
      type: "string",
      description: "Who the form is about (e.g., 'student', 'patient')",
    },
  },
  required: ["formType", "formSubject"],
};

/**
 * Parse context scan response
 */
function parseContextScanResponse(text: string): { formType: string; formSubject: string } {
  // Clean up markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      formType: parsed.formType || "unknown form",
      formSubject: parsed.formSubject || "unknown",
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse context scan response:", {
      error,
      text: cleaned.slice(0, 200),
    });
    return {
      formType: "unknown form",
      formSubject: "unknown",
    };
  }
}

/**
 * Quick context scan of a page
 *
 * Runs fast using Gemini Flash to identify form type and subject.
 * No grid overlay - sees the raw page for quick classification.
 *
 * @param pageImageBase64 - Raw page image (no overlay)
 * @param pageNumber - Page number for logging
 */
export async function quickContextScan(options: {
  pageImageBase64: string;
  pageNumber: number;
}): Promise<ContextScanResult> {
  const { pageImageBase64, pageNumber } = options;
  const startTime = Date.now();

  console.log("[AutoForm] Running quick context scan:", { pageNumber });

  const prompt = buildContextScanPrompt();

  const imagePart = {
    inlineData: {
      data: pageImageBase64,
      mimeType: "image/png",
    },
  };

  try {
    const responseText = await generateWithVisionFast({
      prompt,
      imageParts: [imagePart],
      jsonOutput: true,
      responseSchema: contextScanSchema,
    });

    const durationMs = Date.now() - startTime;
    const { formType, formSubject } = parseContextScanResponse(responseText);

    console.log("[AutoForm] Context scan complete:", {
      pageNumber,
      formType,
      formSubject,
      durationMs,
    });

    return {
      formType,
      formSubject,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("[AutoForm] Context scan failed:", {
      pageNumber,
      error,
      durationMs,
    });

    return {
      formType: "unknown form",
      formSubject: "unknown",
      durationMs,
    };
  }
}
