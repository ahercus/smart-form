// Question generation orchestrator - runs after Document AI has extracted fields
// This is called when page images are uploaded from the client
//
// OPTIMIZED FLOW:
// 1. Set phase to "displaying" - fields visible, questions coming
// 2. Process pages (questions generated first, then enhancement)
// 3. Set phase to "enhancing" - Gemini Vision QC running
// 4. Set phase to "ready" - all done

import { updateProcessingProgress } from "./state";
import { processPages } from "./page-processor";
import { createAdminClient } from "../supabase/admin";
import { StepTimer, formatDuration } from "../timing";
import type { ExtractedField } from "../types";

interface QuestionGeneratorParams {
  documentId: string;
  userId: string;
  pageImages: Array<{
    pageNumber: number;
    imageBase64: string;
  }>;
}

export interface QuestionGeneratorResult {
  success: boolean;
  questionsGenerated: number;
  error?: string;
}

export async function generateQuestions(
  params: QuestionGeneratorParams
): Promise<QuestionGeneratorResult> {
  const { documentId, userId, pageImages } = params;

  const supabase = createAdminClient();

  // Check for existing processing lock to prevent duplicate runs
  const { data: doc } = await supabase
    .from("documents")
    .select("status, processing_lock")
    .eq("id", documentId)
    .single();

  const now = Date.now();
  const lockAge = doc?.processing_lock ? now - new Date(doc.processing_lock).getTime() : Infinity;
  const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes - stale lock timeout

  // If already processing and lock is fresh, skip
  if (doc?.status === "extracting" && lockAge < LOCK_TIMEOUT) {
    console.log("[AutoForm] Question generation already in progress, skipping:", {
      documentId,
      lockAge: `${Math.round(lockAge / 1000)}s`,
    });
    return {
      success: true,
      questionsGenerated: 0,
    };
  }

  // Acquire lock
  const { error: lockError } = await supabase
    .from("documents")
    .update({ processing_lock: new Date().toISOString() })
    .eq("id", documentId);

  if (lockError) {
    console.error("[AutoForm] Failed to acquire processing lock:", lockError);
  }

  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] Question generation starting:", {
    documentId,
    userId,
    pageImageCount: pageImages.length,
    pageNumbers: pageImages.map((p) => p.pageNumber),
  });
  console.log("[AutoForm] ==========================================");

  try {
    // Get existing fields from database
    const { data: fields, error: fieldsError } = await supabase
      .from("extracted_fields")
      .select("*")
      .eq("document_id", documentId)
      .is("deleted_at", null)
      .order("page_number")
      .order("field_index");

    if (fieldsError) {
      throw new Error(`Failed to get fields: ${fieldsError.message}`);
    }

    console.log("[AutoForm] Fields fetched from database:", {
      documentId,
      fieldCount: fields?.length || 0,
    });

    // Even if no fields were extracted by Document AI, we can still generate questions
    // by having Gemini Vision analyze the page images directly
    if (!fields || fields.length === 0) {
      console.log("[AutoForm] No Document AI fields found, Gemini Vision will analyze pages directly:", {
        documentId,
      });
    }

    // Phase: DISPLAYING - Fields visible, questions being generated
    await updateProcessingProgress(documentId, {
      phase: "displaying",
      pagesTotal: pageImages.length,
      pagesComplete: 0,
      questionsDelivered: 0,
    });

    await updateDocumentStatus(documentId, "extracting");

    // Group fields by page
    const fieldsByPage = new Map<number, ExtractedField[]>();
    for (const field of fields) {
      const pageFields = fieldsByPage.get(field.page_number) || [];
      pageFields.push(field as ExtractedField);
      fieldsByPage.set(field.page_number, pageFields);
    }

    // Process pages with images
    const pagesToProcess = pageImages.map((img) => ({
      pageNumber: img.pageNumber,
      imageBase64: img.imageBase64,
      fields: fieldsByPage.get(img.pageNumber) || [],
    }));

    // Check if QC already done - if so, skip enhancing phase
    const { data: docStatus } = await supabase
      .from("documents")
      .select("fields_qc_complete")
      .eq("id", documentId)
      .single();

    const fieldsAlreadyQCd = docStatus?.fields_qc_complete || false;

    if (!fieldsAlreadyQCd) {
      // Phase: ENHANCING - Gemini Vision QC running in background
      await updateProcessingProgress(documentId, {
        phase: "enhancing",
      });
    }

    const pageResults = await processPages(documentId, userId, pagesToProcess);

    const totalQuestions = pageResults.reduce(
      (sum, r) => sum + r.questionsGenerated,
      0
    );

    // Log timing summary
    const totalTime = pageResults.reduce((sum, r) => sum + r.timings.total, 0);
    console.log("[AutoForm] ==========================================");
    console.log("[AutoForm] QUESTION GENERATION COMPLETE:", {
      documentId,
      totalQuestions,
      pagesProcessed: pageResults.length,
      totalTime: formatDuration(totalTime),
      timingBreakdown: {
        initialQuestions: formatDuration(pageResults.reduce((s, r) => s + r.timings.initialQuestions, 0)),
        compositing: formatDuration(pageResults.reduce((s, r) => s + r.timings.compositing, 0)),
        geminiVision: formatDuration(pageResults.reduce((s, r) => s + r.timings.geminiVision, 0)),
        fieldUpdates: formatDuration(pageResults.reduce((s, r) => s + r.timings.fieldUpdates, 0)),
        questionAdjustments: formatDuration(pageResults.reduce((s, r) => s + r.timings.questionAdjustments, 0)),
      },
    });
    console.log("[AutoForm] ==========================================");

    // Phase: READY - All done
    await updateProcessingProgress(documentId, {
      phase: "ready",
      pagesComplete: pageImages.length,
      questionsDelivered: totalQuestions,
    });

    await updateDocumentStatus(documentId, "ready");

    // Clear processing lock
    await supabase
      .from("documents")
      .update({ processing_lock: null })
      .eq("id", documentId);

    return {
      success: true,
      questionsGenerated: totalQuestions,
    };
  } catch (error) {
    console.error("[AutoForm] Question generation failed:", {
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
      error instanceof Error ? error.message : "Question generation failed"
    );

    // Clear processing lock on failure
    await supabase
      .from("documents")
      .update({ processing_lock: null })
      .eq("id", documentId);

    return {
      success: false,
      questionsGenerated: 0,
      error: error instanceof Error ? error.message : "Question generation failed",
    };
  }
}

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
