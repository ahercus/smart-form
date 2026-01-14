// Question pre-generation - runs immediately after Azure completes
//
// PRE-WARM OPTIMIZATION:
// Generate questions before user submits context, so they're ready instantly.
// Questions are saved with status="pending_context" (hidden from UI).
//
// Flow:
// 1. Azure completes → pre-generate questions (no context/memory)
// 2. User submits context → finalize questions (apply context, make visible)
// 3. QC completes → reconcile (add questions for new fields, hide for removed)
//
// This saves 1-3s of perceived latency after context submission.

import { generateQuestionsForPage } from "../gemini/vision";
import { saveQuestion, getConversationHistory } from "./state";
import { createAdminClient } from "../supabase/admin";
import { StepTimer, formatDuration } from "../timing";
import type { ExtractedField } from "../types";

interface PreGenerateParams {
  documentId: string;
  fields: ExtractedField[];
}

export interface PreGenerateResult {
  success: boolean;
  questionsPregenerated: number;
  error?: string;
}

/**
 * Pre-generate questions from Azure fields
 *
 * Called immediately after Azure DI completes, before user submits context.
 * Questions are saved with status="pending_context" so they don't appear in UI yet.
 */
export async function preGenerateQuestions(
  params: PreGenerateParams
): Promise<PreGenerateResult> {
  const { documentId, fields } = params;
  const supabase = createAdminClient();

  const startTime = Date.now();
  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] ⏱️ QUESTION PRE-GENERATION START:", {
    documentId,
    fieldCount: fields.length,
  });
  console.log("[AutoForm] ==========================================");

  try {
    // Check if already pre-generated (prevents duplicate runs)
    const { data: doc } = await supabase
      .from("documents")
      .select("questions_pregenerated, questions_generated_at")
      .eq("id", documentId)
      .single();

    if (doc?.questions_pregenerated || doc?.questions_generated_at) {
      console.log("[AutoForm] Questions already pre-generated/generated, skipping:", {
        documentId,
        pregenerated: doc.questions_pregenerated,
        generatedAt: doc.questions_generated_at,
      });
      return {
        success: true,
        questionsPregenerated: 0,
      };
    }

    // Group fields by page
    const fieldsByPage = new Map<number, ExtractedField[]>();
    for (const field of fields) {
      const pageFields = fieldsByPage.get(field.page_number) || [];
      pageFields.push(field);
      fieldsByPage.set(field.page_number, pageFields);
    }

    // Get conversation history (likely empty at this point)
    const conversationHistory = await getConversationHistory(documentId);

    let totalQuestions = 0;

    // Process pages in parallel (no context, no memory - just base questions)
    const pagePromises = Array.from(fieldsByPage.entries()).map(
      async ([pageNumber, pageFields]) => {
        const pageTimer = new StepTimer(documentId, `Pre-gen Page ${pageNumber}`);

        try {
          // Generate questions WITHOUT context or memory
          // These will be enhanced when context arrives
          const result = await generateQuestionsForPage({
            documentId,
            pageNumber,
            pageImageBase64: "", // Not needed for Flash (no vision)
            fields: pageFields,
            conversationHistory,
            contextNotes: undefined, // No context yet
            memoryContext: undefined, // No memory yet - will be applied during finalization
          });

          // Save questions with status="pending_context" (hidden from UI)
          let savedCount = 0;
          for (const q of result.questions) {
            try {
              await saveQuestion(documentId, {
                question: q.question,
                fieldIds: q.fieldIds,
                inputType: q.inputType,
                profileKey: q.profileKey,
                pageNumber,
                choices: q.choices,
                status: "pending_context", // Hidden until finalized
              });
              savedCount++;
            } catch (error) {
              console.error("[AutoForm] Failed to save pre-generated question:", {
                documentId,
                pageNumber,
                question: q.question.slice(0, 50),
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }

          const duration = pageTimer.end({
            fieldsProcessed: pageFields.length,
            questionsGenerated: savedCount,
          });

          console.log(`[AutoForm] Pre-generation page ${pageNumber} complete:`, {
            documentId,
            fields: pageFields.length,
            questions: savedCount,
            duration: formatDuration(duration),
          });

          return savedCount;
        } catch (error) {
          console.error(`[AutoForm] Pre-generation failed for page ${pageNumber}:`, {
            documentId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          return 0;
        }
      }
    );

    const pageCounts = await Promise.all(pagePromises);
    totalQuestions = pageCounts.reduce((sum, count) => sum + count, 0);

    // Mark document as pre-generated
    await supabase
      .from("documents")
      .update({
        questions_pregenerated: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    const duration = Date.now() - startTime;
    console.log("[AutoForm] ==========================================");
    console.log(`[AutoForm] ⏱️ QUESTION PRE-GENERATION COMPLETE (${(duration / 1000).toFixed(1)}s):`, {
      documentId,
      questionsPregenerated: totalQuestions,
      pagesProcessed: fieldsByPage.size,
    });
    console.log("[AutoForm] ==========================================");

    return {
      success: true,
      questionsPregenerated: totalQuestions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Question pre-generation failed:", {
      documentId,
      error: errorMessage,
    });

    // Non-fatal: questions will be generated normally when context is submitted
    return {
      success: false,
      questionsPregenerated: 0,
      error: errorMessage,
    };
  }
}
