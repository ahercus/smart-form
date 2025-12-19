// Document processing using Google Document AI and Gemini
// Fails with clear errors if APIs are not configured

import type { ExtractedField } from "./types";

export interface ProcessingResult {
  success: boolean;
  pageCount: number;
  fields: ExtractedField[];
  error?: string;
}

function checkRequiredEnvVars(): void {
  const required = [
    "GOOGLE_DOCUMENT_AI_API_KEY",
    "GOOGLE_DOCUMENT_AI_PROCESSOR_ID",
    "GOOGLE_CLOUD_PROJECT_ID",
  ];

  const missing = required.filter((key) => !process.env[key] || process.env[key]?.startsWith("your_"));

  if (missing.length > 0) {
    throw new Error(
      `Document processing requires the following environment variables to be configured: ${missing.join(", ")}. ` +
      `Please add valid API credentials to .env.local`
    );
  }
}

export async function processDocument(
  documentId: string,
  _fileData: ArrayBuffer,
  onStatusChange: (status: string) => Promise<void>
): Promise<ProcessingResult> {
  try {
    // Validate that required APIs are configured
    checkRequiredEnvVars();

    await onStatusChange("analyzing");
    console.log(`[AutoForm] Starting Document AI analysis:`, { documentId });

    // TODO: Implement real Document AI call
    // const documentAiResult = await callDocumentAI(fileData);

    throw new Error(
      "Document AI integration not yet implemented. " +
      "Please configure GOOGLE_DOCUMENT_AI_API_KEY, GOOGLE_DOCUMENT_AI_PROCESSOR_ID, and GOOGLE_CLOUD_PROJECT_ID, " +
      "then implement the Document AI API call in src/lib/processing.ts"
    );
  } catch (error) {
    console.error(`[AutoForm] Processing failed:`, error);
    return {
      success: false,
      pageCount: 0,
      fields: [],
      error: error instanceof Error ? error.message : "Processing failed",
    };
  }
}
