// Document Orchestrator - Stateless parallel processing pipeline
// All state is persisted to Supabase for cross-device continuity

import { extractFieldsFromPDF } from "../document-ai";
import { updateProcessingProgress, getProcessingProgress } from "./state";
import { processPages } from "./page-processor";
import { createAdminClient } from "../supabase/admin";
import type { ExtractedField, ProcessingProgress } from "../types";

interface OrchestratorParams {
  documentId: string;
  userId: string;
  pdfData: ArrayBuffer;
  pageImages: Array<{
    pageNumber: number;
    imageBase64: string;
  }>;
}

export interface OrchestratorResult {
  success: boolean;
  pageCount: number;
  fields: ExtractedField[];
  questionsGenerated: number;
  error?: string;
}

export async function runOrchestrator(
  params: OrchestratorParams
): Promise<OrchestratorResult> {
  const { documentId, userId, pdfData, pageImages } = params;

  console.log("[AutoForm] Orchestrator starting:", {
    documentId,
    pdfSize: pdfData.byteLength,
    pageImageCount: pageImages.length,
  });

  try {
    // Phase 1: Document AI Parsing
    await updateProcessingProgress(documentId, {
      phase: "parsing",
      pagesTotal: pageImages.length,
      pagesComplete: 0,
      questionsDelivered: 0,
    });

    await updateDocumentStatus(documentId, "analyzing");

    const docAIResult = await extractFieldsFromPDF(documentId, pdfData);

    console.log("[AutoForm] Document AI complete:", {
      documentId,
      pageCount: docAIResult.pageCount,
      fieldCount: docAIResult.fields.length,
    });

    // Save fields to database
    await saveFields(documentId, docAIResult.fields);

    // Save extraction response
    await saveExtractionResponse(documentId, docAIResult.rawResponse);

    // Update page count
    await updatePageCount(documentId, docAIResult.pageCount);

    // Phase 2: Displaying - Fields visible to user, questions being generated
    await updateProcessingProgress(documentId, {
      phase: "displaying",
      pagesTotal: docAIResult.pageCount,
    });

    await updateDocumentStatus(documentId, "extracting");

    // Group fields by page
    const fieldsByPage = new Map<number, ExtractedField[]>();
    for (const field of docAIResult.fields) {
      const pageFields = fieldsByPage.get(field.page_number) || [];
      pageFields.push(field);
      fieldsByPage.set(field.page_number, pageFields);
    }

    // Process pages with images
    const pagesToProcess = pageImages.map((img) => ({
      pageNumber: img.pageNumber,
      imageBase64: img.imageBase64,
      fields: fieldsByPage.get(img.pageNumber) || [],
    }));

    const pageResults = await processPages(documentId, userId, pagesToProcess);

    const totalQuestions = pageResults.reduce(
      (sum, r) => sum + r.questionsGenerated,
      0
    );

    console.log("[AutoForm] Question generation complete:", {
      documentId,
      totalQuestions,
      pagesProcessed: pageResults.length,
    });

    // Phase 3: Ready
    await updateProcessingProgress(documentId, {
      phase: "ready",
      pagesComplete: docAIResult.pageCount,
    });

    await updateDocumentStatus(documentId, "ready");

    console.log("[AutoForm] Orchestrator complete:", {
      documentId,
      success: true,
      pageCount: docAIResult.pageCount,
      fieldCount: docAIResult.fields.length,
      questionsGenerated: totalQuestions,
    });

    return {
      success: true,
      pageCount: docAIResult.pageCount,
      fields: docAIResult.fields,
      questionsGenerated: totalQuestions,
    };
  } catch (error) {
    console.error("[AutoForm] Orchestrator failed:", {
      documentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    await updateProcessingProgress(documentId, {
      phase: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });

    await updateDocumentStatus(
      documentId,
      "failed",
      error instanceof Error ? error.message : "Processing failed"
    );

    return {
      success: false,
      pageCount: 0,
      fields: [],
      questionsGenerated: 0,
      error: error instanceof Error ? error.message : "Processing failed",
    };
  }
}

// Resume processing from where it left off (for cross-device continuity)
export async function resumeProcessing(
  documentId: string
): Promise<ProcessingProgress> {
  const progress = await getProcessingProgress(documentId);

  console.log("[AutoForm] Checking processing status:", {
    documentId,
    phase: progress.phase,
    pagesComplete: progress.pagesComplete,
    pagesTotal: progress.pagesTotal,
  });

  return progress;
}

// Helper functions
async function updateDocumentStatus(
  documentId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("documents")
    .update({
      status,
      error_message: errorMessage || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}

async function saveFields(
  documentId: string,
  fields: ExtractedField[]
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("extracted_fields").insert(
    fields.map((f) => ({
      ...f,
      document_id: documentId,
    }))
  );

  if (error) {
    console.error("[AutoForm] Failed to save fields:", error);
    throw error;
  }
}

async function saveExtractionResponse(
  documentId: string,
  response: unknown
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("documents")
    .update({
      extraction_response: response,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}

async function updatePageCount(
  documentId: string,
  pageCount: number
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("documents")
    .update({
      page_count: pageCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}

// Export for use in API routes
export { updateProcessingProgress, getProcessingProgress } from "./state";
