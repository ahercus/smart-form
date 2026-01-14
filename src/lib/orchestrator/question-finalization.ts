// Question finalization - runs when BOTH context and QC are ready
//
// PRE-WARM FINALIZATION:
// Questions were pre-generated from Azure fields (status="pending_context").
// Now we finalize them by:
// 1. Filtering out questions for QC-deleted fields
// 2. Applying context to auto-answer questions
// 3. Generating questions for QC-discovered fields
// 4. Making remaining questions visible
//
// This happens when BOTH:
// - User has submitted context (context_submitted = true)
// - QC has completed (fields_qc_complete = true)

import { reevaluatePendingQuestions, generateQuestionsForPage } from "../gemini/vision";
import { saveQuestion, updateQuestion, batchUpdateFieldValues, getConversationHistory } from "./state";
import { createAdminClient } from "../supabase/admin";
import { getMemoryContext } from "../memory";
import type { ExtractedField, QuestionGroup } from "../types";

interface FinalizeParams {
  documentId: string;
  userId: string;
  contextNotes?: string;
  useMemory?: boolean;
}

export interface FinalizeResult {
  success: boolean;
  questionsFinalized: number;
  questionsHidden: number;
  questionsAdded: number;
  autoAnswered: number;
  error?: string;
}

/**
 * Finalize pre-generated questions
 *
 * Called when both context is submitted AND QC is complete.
 * Reconciles pre-generated questions with QC'd fields and applies context.
 */
export async function finalizeQuestions(
  params: FinalizeParams
): Promise<FinalizeResult> {
  const { documentId, userId, contextNotes, useMemory = true } = params;
  const supabase = createAdminClient();

  const startTime = Date.now();
  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] ⏱️ QUESTION FINALIZATION START:", {
    documentId,
    hasContext: !!contextNotes,
    useMemory,
  });
  console.log("[AutoForm] ==========================================");

  try {
    // 1. Get pending questions and QC'd fields
    const [questionsResult, fieldsResult] = await Promise.all([
      supabase
        .from("document_questions")
        .select("*")
        .eq("document_id", documentId)
        .eq("status", "pending_context"),
      supabase
        .from("extracted_fields")
        .select("*")
        .eq("document_id", documentId)
        .is("deleted_at", null),
    ]);

    const pendingQuestions = (questionsResult.data || []) as QuestionGroup[];
    const qcdFields = (fieldsResult.data || []) as ExtractedField[];

    console.log("[AutoForm] Finalization data fetched:", {
      documentId,
      pendingQuestions: pendingQuestions.length,
      qcdFields: qcdFields.length,
    });

    if (pendingQuestions.length === 0) {
      console.log("[AutoForm] No pending questions to finalize");

      // Mark questions as generated (prevents future pre-generation attempts)
      await supabase
        .from("documents")
        .update({
          questions_generated_at: new Date().toISOString(),
          questions_pregenerated: false, // Clear flag
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      return {
        success: true,
        questionsFinalized: 0,
        questionsHidden: 0,
        questionsAdded: 0,
        autoAnswered: 0,
      };
    }

    // 2. Filter out questions for deleted fields
    const qcdFieldIds = new Set(qcdFields.map((f) => f.id));
    const validQuestions = pendingQuestions.filter((q) =>
      q.field_ids.every((id) => qcdFieldIds.has(id))
    );
    const invalidQuestions = pendingQuestions.filter(
      (q) => !q.field_ids.every((id) => qcdFieldIds.has(id))
    );

    console.log("[AutoForm] Question validation:", {
      documentId,
      valid: validQuestions.length,
      invalid: invalidQuestions.length,
    });

    // Hide questions for deleted fields
    if (invalidQuestions.length > 0) {
      await Promise.all(
        invalidQuestions.map((q) =>
          supabase
            .from("document_questions")
            .update({ status: "hidden", updated_at: new Date().toISOString() })
            .eq("id", q.id)
        )
      );
      console.log("[AutoForm] Hidden questions for deleted fields:", {
        documentId,
        count: invalidQuestions.length,
      });
    }

    // 3. Generate questions for QC-discovered fields (not covered by pre-gen)
    const coveredFieldIds = new Set(validQuestions.flatMap((q) => q.field_ids));
    const uncoveredNewFields = qcdFields.filter(
      (f) => f.detection_source === "gemini_vision" && !coveredFieldIds.has(f.id)
    );

    let questionsAdded = 0;
    if (uncoveredNewFields.length > 0) {
      console.log("[AutoForm] Generating questions for QC-discovered fields:", {
        documentId,
        fieldCount: uncoveredNewFields.length,
        labels: uncoveredNewFields.map((f) => f.label),
      });

      // Group by page
      const fieldsByPage = new Map<number, ExtractedField[]>();
      for (const field of uncoveredNewFields) {
        const pageFields = fieldsByPage.get(field.page_number) || [];
        pageFields.push(field);
        fieldsByPage.set(field.page_number, pageFields);
      }

      // Get conversation history and memory context
      const conversationHistory = await getConversationHistory(documentId);
      const memoryContext = useMemory ? await getMemoryContext(userId) : "";

      // Generate questions for each page
      for (const [pageNumber, pageFields] of fieldsByPage.entries()) {
        try {
          const result = await generateQuestionsForPage({
            documentId,
            pageNumber,
            pageImageBase64: "", // Not needed for Flash
            fields: pageFields,
            conversationHistory,
            contextNotes,
            memoryContext,
          });

          // Save new questions as visible (context already applied)
          for (const q of result.questions) {
            try {
              await saveQuestion(documentId, {
                question: q.question,
                fieldIds: q.fieldIds,
                inputType: q.inputType,
                profileKey: q.profileKey,
                pageNumber,
                choices: q.choices,
                status: "visible", // Already finalized
              });
              questionsAdded++;
            } catch (error) {
              console.error("[AutoForm] Failed to save QC question:", {
                documentId,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }

          // Apply auto-answers for new fields
          if (result.autoAnswered.length > 0) {
            await batchUpdateFieldValues(
              result.autoAnswered.map((a) => ({
                fieldId: a.fieldId,
                value: a.value,
              }))
            );
          }
        } catch (error) {
          console.error("[AutoForm] Failed to generate QC field questions:", {
            documentId,
            pageNumber,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    // 4. Apply context to auto-answer existing questions
    let autoAnsweredCount = 0;
    if (contextNotes && validQuestions.length > 0) {
      try {
        const autoAnswers = await reevaluatePendingQuestions({
          newAnswer: { question: "User provided context", answer: contextNotes },
          pendingQuestions: validQuestions.map((q) => ({
            id: q.id,
            question: q.question,
            fieldIds: q.field_ids,
          })),
          fields: qcdFields,
        });

        console.log("[AutoForm] Context auto-answers:", {
          documentId,
          autoAnswerCount: autoAnswers.length,
        });

        // Apply auto-answers
        for (const aa of autoAnswers) {
          const question = validQuestions.find((q) => q.id === aa.questionId);
          if (question) {
            // Mark question as answered
            await updateQuestion(aa.questionId, {
              status: "answered",
              answer: aa.answer,
            });

            // Update field values
            await batchUpdateFieldValues(
              question.field_ids.map((fieldId) => ({
                fieldId,
                value: aa.answer,
              }))
            );

            autoAnsweredCount++;
          }
        }
      } catch (error) {
        console.error("[AutoForm] Context application failed (non-fatal):", {
          documentId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        // Continue - questions will still be made visible
      }
    }

    // 5. Make remaining questions visible
    const remainingQuestionIds = validQuestions
      .filter((q) => !validQuestions.find((vq) => vq.id === q.id && vq.status === "answered"))
      .map((q) => q.id);

    if (remainingQuestionIds.length > 0) {
      await supabase
        .from("document_questions")
        .update({ status: "visible", updated_at: new Date().toISOString() })
        .eq("document_id", documentId)
        .eq("status", "pending_context");
    }

    // 6. Mark as complete
    await supabase
      .from("documents")
      .update({
        questions_generated_at: new Date().toISOString(),
        questions_pregenerated: false, // Clear flag
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    const duration = Date.now() - startTime;
    console.log("[AutoForm] ==========================================");
    console.log(`[AutoForm] ⏱️ QUESTION FINALIZATION COMPLETE (${(duration / 1000).toFixed(1)}s):`, {
      documentId,
      finalized: validQuestions.length,
      hidden: invalidQuestions.length,
      added: questionsAdded,
      autoAnswered: autoAnsweredCount,
    });
    console.log("[AutoForm] ==========================================");

    return {
      success: true,
      questionsFinalized: validQuestions.length - autoAnsweredCount,
      questionsHidden: invalidQuestions.length,
      questionsAdded,
      autoAnswered: autoAnsweredCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Question finalization failed:", {
      documentId,
      error: errorMessage,
    });

    // On failure, still try to make pending questions visible
    // Better to show potentially-stale questions than nothing
    try {
      await supabase
        .from("document_questions")
        .update({ status: "visible", updated_at: new Date().toISOString() })
        .eq("document_id", documentId)
        .eq("status", "pending_context");

      await supabase
        .from("documents")
        .update({
          questions_generated_at: new Date().toISOString(),
          questions_pregenerated: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      questionsFinalized: 0,
      questionsHidden: 0,
      questionsAdded: 0,
      autoAnswered: 0,
      error: errorMessage,
    };
  }
}

/**
 * Check if finalization conditions are met and trigger if ready
 */
export async function checkAndFinalizeIfReady(
  documentId: string,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("context_submitted, fields_qc_complete, questions_pregenerated, questions_generated_at, context_notes, use_memory")
    .eq("id", documentId)
    .single();

  if (!doc) {
    console.log("[AutoForm] Document not found for finalization check:", { documentId });
    return false;
  }

  // Already finalized
  if (doc.questions_generated_at) {
    console.log("[AutoForm] Questions already generated:", { documentId });
    return false;
  }

  // Check conditions
  const canFinalize =
    doc.context_submitted &&
    doc.fields_qc_complete &&
    doc.questions_pregenerated;

  console.log("[AutoForm] Finalization check:", {
    documentId,
    context_submitted: doc.context_submitted,
    fields_qc_complete: doc.fields_qc_complete,
    questions_pregenerated: doc.questions_pregenerated,
    canFinalize,
  });

  if (canFinalize) {
    await finalizeQuestions({
      documentId,
      userId,
      contextNotes: doc.context_notes || undefined,
      useMemory: doc.use_memory ?? true,
    });
    return true;
  }

  return false;
}
