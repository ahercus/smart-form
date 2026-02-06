// Per-page question generation pipeline
//
// This runs AFTER field QC is complete (handled by /refine-fields route).
// By this point, fields have been validated/adjusted by Gemini Vision.
//
// Flow:
// 1. Generate questions for all QC'd fields on the page
// 2. Save questions to database
// 3. Apply any auto-answered values from user context

import { generateQuestionsForPage } from "../gemini/vision";
import {
  getConversationHistory,
  saveQuestion,
  batchUpdateFieldValues,
} from "./state";
import { createAdminClient } from "../supabase/admin";
import { StepTimer, formatDuration } from "../timing";
import { getEntityMemoryContext } from "../memory/context";
import type { ExtractedField } from "../types";

interface ProcessPageParams {
  documentId: string;
  userId: string;
  pageNumber: number;
  pageImageBase64: string;
  fields: ExtractedField[]; // Document AI fields for this page (may be empty)
  useMemory?: boolean;
}

export interface PageProcessingResult {
  pageNumber: number;
  timings: {
    questionGeneration: number;
    total: number;
  };
  fieldsProcessed: number;
  questionsGenerated: number;
  autoAnswered: number;
}

export async function processPage(
  params: ProcessPageParams
): Promise<PageProcessingResult> {
  const { documentId, userId, pageNumber, pageImageBase64, fields, useMemory = true } = params;
  const supabase = createAdminClient();
  const totalTimer = new StepTimer(documentId, `Page ${pageNumber} Processing`);

  // Fetch context notes from document (user-provided context for auto-fill)
  const { data: doc } = await supabase
    .from("documents")
    .select("context_notes")
    .eq("id", documentId)
    .single();
  const contextNotes = doc?.context_notes || undefined;

  // Fetch user's saved memory context only if useMemory is enabled
  const memoryContext = useMemory ? await getEntityMemoryContext(userId) : "";

  console.log(`[AutoForm] Processing page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    hasContext: !!contextNotes,
    hasMemory: !!memoryContext,
    useMemory,
  });

  // If no fields, nothing to generate questions for
  if (fields.length === 0) {
    console.log(`[AutoForm] No fields on page ${pageNumber}, skipping question generation`);
    const totalDuration = totalTimer.end({ skipped: true });
    return {
      pageNumber,
      timings: { questionGeneration: 0, total: totalDuration },
      fieldsProcessed: 0,
      questionsGenerated: 0,
      autoAnswered: 0,
    };
  }

  // Generate questions for all fields on this page
  const questionTimer = new StepTimer(documentId, `Question Generation (Page ${pageNumber})`);
  const conversationHistory = await getConversationHistory(documentId);

  const result = await generateQuestionsForPage({
    documentId,
    pageNumber,
    pageImageBase64,
    fields,
    conversationHistory,
    contextNotes,
    memoryContext,
  });

  // Save questions to database (continue on individual failures)
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
      });
      savedCount++;
    } catch (error) {
      console.error(`[AutoForm] Failed to save question, continuing:`, {
        documentId,
        pageNumber,
        question: q.question.slice(0, 50),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Continue with next question instead of failing entirely
    }
  }

  // Apply any auto-answered fields from context (non-critical)
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
      console.error(`[AutoForm] Failed to apply auto-answers, continuing:`, {
        documentId,
        pageNumber,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const questionDuration = questionTimer.end({
    questionsGenerated: savedCount,
    autoAnswered: autoAnsweredCount,
  });

  const totalDuration = totalTimer.end({
    fieldsProcessed: fields.length,
    questionsGenerated: savedCount,
  });

  console.log(`[AutoForm] Page ${pageNumber} complete:`, {
    documentId,
    questionsGenerated: savedCount,
    questionsFailed: result.questions.length - savedCount,
    autoAnswered: autoAnsweredCount,
    duration: formatDuration(totalDuration),
  });

  return {
    pageNumber,
    timings: {
      questionGeneration: questionDuration,
      total: totalDuration,
    },
    fieldsProcessed: fields.length,
    questionsGenerated: savedCount,
    autoAnswered: autoAnsweredCount,
  };
}

/**
 * Process multiple pages in PARALLEL
 *
 * WHY PARALLEL PROCESSING IS SAFE:
 *
 * 1. Each page has its own field set (independent)
 * 2. Conversation context is passed IN the prompt (not mutated between pages)
 * 3. Database writes are independent (different field IDs, different question IDs)
 * 4. Gemini API handles concurrent requests fine
 *
 * PERFORMANCE IMPACT:
 * - Sequential: 5-page form = 5 × 2s = 10 seconds
 * - Parallel: 5-page form = 2s (longest page) = 2 seconds
 * - 5x speedup for multi-page forms
 *
 * CONVERSATION CONTEXT:
 * - Each page gets the same conversationHistory (fetched once before parallel)
 * - Pages don't need to know about each other's NEW questions
 * - Gemini's "skip if already asked" instruction handles cross-page duplication
 */
export async function processPages(
  documentId: string,
  userId: string,
  pages: Array<{
    pageNumber: number;
    imageBase64: string;
    fields: ExtractedField[];
  }>,
  useMemory: boolean = true
): Promise<PageProcessingResult[]> {
  const totalTimer = new StepTimer(documentId, `All Pages PARALLEL (${pages.length})`);

  console.log(`[AutoForm] Processing ${pages.length} pages in PARALLEL:`, {
    documentId,
    pageNumbers: pages.map((p) => p.pageNumber),
  });

  // Process all pages in parallel
  const pagePromises = pages.map((page) =>
    processPage({
      documentId,
      userId,
      pageNumber: page.pageNumber,
      pageImageBase64: page.imageBase64,
      fields: page.fields,
      useMemory,
    })
  );

  const results = await Promise.all(pagePromises);

  const totalQuestions = results.reduce((sum, r) => sum + r.questionsGenerated, 0);
  const totalAutoAnswered = results.reduce((sum, r) => sum + r.autoAnswered, 0);
  const longestPageTime = Math.max(...results.map((r) => r.timings.total));
  const totalDuration = totalTimer.end({
    pagesProcessed: pages.length,
    totalQuestions,
    totalAutoAnswered,
  });

  console.log(`[AutoForm] All pages complete (PARALLEL):`, {
    documentId,
    pagesProcessed: pages.length,
    totalQuestions,
    totalAutoAnswered,
    wallClockTime: formatDuration(totalDuration),
    longestPage: formatDuration(longestPageTime),
    perPage: results.map((r) => ({
      page: r.pageNumber,
      questions: r.questionsGenerated,
      duration: formatDuration(r.timings.total),
    })),
  });

  return results;
}
