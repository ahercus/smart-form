// Question generation orchestrator
//
// This runs AFTER field QC is complete (triggered by /context route).
// The /context route waits for fields_qc_complete before calling this.
//
// Flow:
// 1. Set phase to "displaying" - fields visible, questions being generated
// 2. Generate questions for each page (one Gemini call per page)
// 3. Set phase to "ready" - all done

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
  useMemory?: boolean;
}

export interface QuestionGeneratorResult {
  success: boolean;
  questionsGenerated: number;
  error?: string;
}

export async function generateQuestions(
  params: QuestionGeneratorParams
): Promise<QuestionGeneratorResult> {
  const { documentId, userId, pageImages, useMemory = true } = params;

  const supabase = createAdminClient();

  // Check for existing processing lock and questions_generated_at to prevent duplicate runs
  const { data: doc } = await supabase
    .from("documents")
    .select("status, processing_lock, questions_generated_at")
    .eq("id", documentId)
    .single();

  const now = Date.now();
  const lockAge = doc?.processing_lock ? now - new Date(doc.processing_lock).getTime() : Infinity;
  const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes - stale lock timeout

  // If questions were already generated, skip (prevents duplicate generation)
  if (doc?.questions_generated_at) {
    console.log("[AutoForm] Questions already generated, skipping:", {
      documentId,
      generatedAt: doc.questions_generated_at,
    });
    return {
      success: true,
      questionsGenerated: 0,
    };
  }

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

  const questionGenStartTime = Date.now();
  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] ⏱️ QUESTION GENERATION START:", {
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

    // If no fields were extracted yet, Gemini will analyze pages directly
    if (!fields || fields.length === 0) {
      console.log("[AutoForm] No fields found, Gemini Vision will analyze pages directly:", {
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
    // Note: Field QC is already complete at this point (context route waits for it)
    const pagesToProcess = pageImages.map((img) => ({
      pageNumber: img.pageNumber,
      imageBase64: img.imageBase64,
      fields: fieldsByPage.get(img.pageNumber) || [],
    }));

    const pageResults = await processPages(documentId, userId, pagesToProcess, useMemory);

    const totalQuestions = pageResults.reduce((sum, r) => sum + r.questionsGenerated, 0);
    const totalAutoAnswered = pageResults.reduce((sum, r) => sum + r.autoAnswered, 0);
    const totalTime = pageResults.reduce((sum, r) => sum + r.timings.total, 0);

    const questionGenDuration = Date.now() - questionGenStartTime;
    console.log("[AutoForm] ==========================================");
    console.log(`[AutoForm] ⏱️ QUESTION GENERATION COMPLETE (${(questionGenDuration / 1000).toFixed(1)}s):`, {
      documentId,
      totalQuestions,
      totalAutoAnswered,
      pagesProcessed: pageResults.length,
      wallClockTime: `${(questionGenDuration / 1000).toFixed(1)}s`,
      perPageSumTime: formatDuration(totalTime),
    });
    console.log("[AutoForm] ==========================================");

    // Phase: READY - All done
    await updateProcessingProgress(documentId, {
      phase: "ready",
      pagesComplete: pageImages.length,
      questionsDelivered: totalQuestions,
    });

    await updateDocumentStatus(documentId, "ready");

    // Clear processing lock and mark questions as generated (only if we actually generated some)
    // If 0 questions generated (e.g., fields not ready yet), don't set timestamp so retry can happen
    await supabase
      .from("documents")
      .update({
        processing_lock: null,
        questions_generated_at: totalQuestions > 0 ? new Date().toISOString() : null,
      })
      .eq("id", documentId);

    return {
      success: true,
      questionsGenerated: totalQuestions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Question generation failed (graceful degradation):", {
      documentId,
      error: errorMessage,
    });

    // GRACEFUL DEGRADATION: Set status to "ready" so user can still fill form manually
    // The AI assistant won't have questions, but fields are still usable
    await updateProcessingProgress(documentId, {
      phase: "ready",
      error: `AI assistant unavailable: ${errorMessage}`,
    });

    // Document is still usable - just without AI questions
    await updateDocumentStatus(documentId, "ready");

    // Clear processing lock
    await supabase
      .from("documents")
      .update({ processing_lock: null })
      .eq("id", documentId);

    console.log("[AutoForm] Document marked ready despite question generation failure:", {
      documentId,
      reason: "User can still fill form manually",
    });

    return {
      success: false,
      questionsGenerated: 0,
      error: errorMessage,
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
