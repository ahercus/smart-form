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

// TEST MODE: Skip Azure and let Gemini do full detection
// Set SKIP_AZURE=true to test pure Gemini field detection
const SKIP_AZURE = process.env.SKIP_AZURE === "true";

// NEW: Quadrant-based extraction (completely replaces Azure + cluster QC)
// When enabled, Azure is skipped and fields are extracted via 4 parallel Gemini agents
const USE_QUADRANT_EXTRACTION = process.env.USE_QUADRANT_EXTRACTION === "true";

export async function processDocument(
  documentId: string,
  fileData: ArrayBuffer,
  onStatusChange: (status: string) => Promise<void>
): Promise<ProcessingResult> {
  try {
    await onStatusChange("analyzing");

    // Quadrant extraction mode: Skip Azure entirely
    // Fields will be extracted by quadrant agents when page images are available
    if (USE_QUADRANT_EXTRACTION) {
      console.log(`[AutoForm] QUADRANT MODE: Skipping Azure, fields will be extracted via quadrant agents:`, { documentId });

      // Mark as extracting - not ready yet, waiting for page images
      await onStatusChange("extracting");

      // Return empty fields - quadrant extraction will populate these
      return {
        success: true,
        pageCount: 1, // Will be updated by page images
        fields: [],
      };
    }

    if (SKIP_AZURE) {
      console.log(`[AutoForm] TEST MODE: Skipping Azure, will rely on Gemini full-page detection:`, { documentId });

      // Mark as ready so QC can run
      await onStatusChange("ready");

      // Return empty fields - Gemini QC will detect everything from scratch
      return {
        success: true,
        pageCount: 1, // Will be updated by page images
        fields: [],
      };
    }

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
