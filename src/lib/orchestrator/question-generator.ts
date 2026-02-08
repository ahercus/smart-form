/**
 * Question generation orchestrator
 *
 * NEW ARCHITECTURE: Single consolidated question writer
 *
 * This runs AFTER field extraction is complete.
 * Receives full document context:
 * - All fields from all pages
 * - Full document OCR text (from Azure)
 * - User's saved memory context
 *
 * Generates questions that can span multiple pages,
 * with intelligent entity detection and field grouping.
 */

import { updateProcessingProgress, saveQuestion, batchUpdateFieldValues } from "./state";
import { createAdminClient } from "../supabase/admin";
import { waitForOcr } from "../azure/ocr";
import { getEntityMemoryContext } from "../memory/context";
import { generateDocumentQuestions } from "../gemini/vision/document-questions";
import type { ExtractedField } from "../types";

interface QuestionGeneratorParams {
  documentId: string;
  userId: string;
  pageImages: Array<{
    pageNumber: number;
    imageBase64: string;
  }>;
  useMemory?: boolean;
  clientDateTime?: string;
  clientTimeZone?: string;
  clientTimeZoneOffsetMinutes?: number;
}

export interface QuestionGeneratorResult {
  success: boolean;
  questionsGenerated: number;
  entitiesDetected: number;
  error?: string;
}

export async function generateQuestions(
  params: QuestionGeneratorParams
): Promise<QuestionGeneratorResult> {
  const {
    documentId,
    userId,
    pageImages,
    useMemory = true,
    clientDateTime,
    clientTimeZone,
    clientTimeZoneOffsetMinutes,
  } = params;

  const supabase = createAdminClient();

  // Check for existing processing lock and questions_generated_at to prevent duplicate runs
  const { data: doc } = await supabase
    .from("documents")
    .select("status, processing_lock, questions_generated_at, context_notes")
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
      entitiesDetected: 0,
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
      entitiesDetected: 0,
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
  console.log("[AutoForm] ⏱️ QUESTION GENERATION START (Document-Wide):", {
    documentId,
    userId,
    pageCount: pageImages.length,
  });
  console.log("[AutoForm] ==========================================");

  try {
    // Phase: DISPLAYING - Fields visible, questions being generated
    await updateProcessingProgress(documentId, {
      phase: "displaying",
      pagesTotal: pageImages.length,
      pagesComplete: 0,
      questionsDelivered: 0,
    });

    await updateDocumentStatus(documentId, "extracting");

    // Get ALL fields from database
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

    console.log("[AutoForm] All fields fetched:", {
      documentId,
      fieldCount: fields?.length || 0,
    });

    if (!fields || fields.length === 0) {
      console.log("[AutoForm] No fields found, skipping question generation");
      await finalize(documentId, 0, pageImages.length);
      return {
        success: true,
        questionsGenerated: 0,
        entitiesDetected: 0,
      };
    }

    // Wait for OCR to complete (runs in parallel with field extraction)
    console.log("[AutoForm] Waiting for OCR to complete...");
    const ocrText = await waitForOcr(documentId, 45000); // 45 second max wait
    console.log("[AutoForm] OCR text received:", {
      documentId,
      textLength: ocrText.length,
      preview: ocrText.slice(0, 200),
    });

    // Get user's memory context
    const memoryContext = useMemory ? await getEntityMemoryContext(userId) : "";
    console.log("[AutoForm] Memory context:", {
      documentId,
      hasMemory: !!memoryContext,
      memoryLength: memoryContext.length,
    });

    // Generate questions with full document context
    const result = await generateDocumentQuestions({
      documentId,
      fields: fields as ExtractedField[],
      ocrText,
      memoryContext,
      contextNotes: doc?.context_notes || undefined,
      clientDateTime,
      clientTimeZone,
      clientTimeZoneOffsetMinutes,
    });

    // Save questions to database
    let savedCount = 0;
    for (const q of result.questions) {
      try {
        // Determine page number from first field (for sorting/display purposes)
        const firstFieldId = q.fieldIds[0];
        const firstField = fields.find((f) => f.id === firstFieldId);
        const pageNumber = firstField?.page_number || 1;

        await saveQuestion(documentId, {
          question: q.question,
          fieldIds: q.fieldIds,
          inputType: q.inputType as ExtractedField["field_type"],
          profileKey: q.profileKey,
          pageNumber,
          choices: q.choices,
        });
        savedCount++;
      } catch (error) {
        console.error("[AutoForm] Failed to save question, continuing:", {
          documentId,
          question: q.question.slice(0, 50),
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Apply auto-answered fields
    let autoAnsweredCount = 0;
    if (result.autoAnswered.length > 0) {
      try {
        await batchUpdateFieldValues(
          result.autoAnswered.map((a) => ({
            fieldId: a.fieldId,
            value: a.value,
          }))
        );
        autoAnsweredCount = result.autoAnswered.length;
      } catch (error) {
        console.error("[AutoForm] Failed to apply auto-answers, continuing:", {
          documentId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const questionGenDuration = Date.now() - questionGenStartTime;
    console.log("[AutoForm] ==========================================");
    console.log(`[AutoForm] ⏱️ QUESTION GENERATION COMPLETE (${(questionGenDuration / 1000).toFixed(1)}s):`, {
      documentId,
      entitiesDetected: result.entities.length,
      questionsGenerated: savedCount,
      autoAnswered: autoAnsweredCount,
      skipped: result.skippedFields.length,
      entities: result.entities.map((e) => e.label),
    });
    console.log("[AutoForm] ==========================================");

    await finalize(documentId, savedCount, pageImages.length);

    return {
      success: true,
      questionsGenerated: savedCount,
      entitiesDetected: result.entities.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Question generation failed (graceful degradation):", {
      documentId,
      error: errorMessage,
    });

    // GRACEFUL DEGRADATION: Set status to "ready" so user can still fill form manually
    await updateProcessingProgress(documentId, {
      phase: "ready",
      error: `AI assistant unavailable: ${errorMessage}`,
    });

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
      entitiesDetected: 0,
      error: errorMessage,
    };
  }
}

async function finalize(
  documentId: string,
  questionsGenerated: number,
  pageCount: number
): Promise<void> {
  const supabase = createAdminClient();

  // Phase: READY - All done
  await updateProcessingProgress(documentId, {
    phase: "ready",
    pagesComplete: pageCount,
    questionsDelivered: questionsGenerated,
  });

  await updateDocumentStatus(documentId, "ready");

  // Clear processing lock and mark questions as generated
  await supabase
    .from("documents")
    .update({
      processing_lock: null,
      questions_generated_at: questionsGenerated > 0 ? new Date().toISOString() : null,
    })
    .eq("id", documentId);
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
