// Document processing - simplified pipeline
// Azure removed: Now uses Gemini single-page extraction

import type { ExtractedField } from "./types";

export interface ProcessingResult {
  success: boolean;
  pageCount: number;
  fields: ExtractedField[];
  error?: string;
}

/**
 * Process a document for field extraction
 *
 * This is a lightweight handler that marks the document as ready for extraction.
 * Actual field extraction happens in /api/documents/[id]/refine-fields via
 * single-page Gemini extraction when page images are available.
 */
export async function processDocument(
  documentId: string,
  _fileData: ArrayBuffer,
  onStatusChange: (status: string) => Promise<void>
): Promise<ProcessingResult> {
  try {
    await onStatusChange("analyzing");

    console.log(`[AutoForm] Document ready for extraction:`, { documentId });

    // Mark as extracting - fields will be extracted via single-page extraction
    await onStatusChange("extracting");

    return {
      success: true,
      pageCount: 1, // Will be updated by page images
      fields: [],
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
