// Document processing using Azure Document Intelligence and Gemini
// Fails with clear errors if APIs are not configured

import type { ExtractedField } from "./types";
import { extractFieldsFromPDF } from "./document-ai";

export interface ProcessingResult {
  success: boolean;
  pageCount: number;
  fields: ExtractedField[];
  error?: string;
}

export async function processDocument(
  documentId: string,
  fileData: ArrayBuffer,
  onStatusChange: (status: string) => Promise<void>
): Promise<ProcessingResult> {
  try {
    await onStatusChange("analyzing");
    console.log(`[AutoForm] Starting Azure Document Intelligence analysis:`, { documentId });

    // Call Azure Document Intelligence to extract form fields
    const result = await extractFieldsFromPDF(documentId, fileData);

    console.log(`[AutoForm] Azure extraction complete:`, {
      documentId,
      pageCount: result.pageCount,
      fieldCount: result.fields.length,
    });

    await onStatusChange("ready");

    return {
      success: true,
      pageCount: result.pageCount,
      fields: result.fields,
    };
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
