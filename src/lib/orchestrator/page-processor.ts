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
import type { ExtractedField } from "../types";

interface ProcessPageParams {
  documentId: string;
  userId: string;
  pageNumber: number;
  pageImageBase64: string;
  fields: ExtractedField[]; // Document AI fields for this page (may be empty)
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
  const { documentId, pageNumber, pageImageBase64, fields } = params;
  const supabase = createAdminClient();
  const totalTimer = new StepTimer(documentId, `Page ${pageNumber} Processing`);

  // Fetch context notes from document (user-provided context for auto-fill)
  const { data: doc } = await supabase
    .from("documents")
    .select("context_notes")
    .eq("id", documentId)
    .single();
  const contextNotes = doc?.context_notes || undefined;

  console.log(`[AutoForm] Processing page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    hasContext: !!contextNotes,
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
  });

  // Save questions to database
  for (const q of result.questions) {
    await saveQuestion(documentId, {
      question: q.question,
      fieldIds: q.fieldIds,
      inputType: q.inputType,
      profileKey: q.profileKey,
      pageNumber,
    });
  }

  // Apply any auto-answered fields from context
  if (result.autoAnswered.length > 0) {
    await batchUpdateFieldValues(
      result.autoAnswered.map((a) => ({
        fieldId: a.fieldId,
        value: a.value,
      }))
    );
  }

  const questionDuration = questionTimer.end({
    questionsGenerated: result.questions.length,
    autoAnswered: result.autoAnswered.length,
  });

  const totalDuration = totalTimer.end({
    fieldsProcessed: fields.length,
    questionsGenerated: result.questions.length,
  });

  console.log(`[AutoForm] Page ${pageNumber} complete:`, {
    documentId,
    questionsGenerated: result.questions.length,
    autoAnswered: result.autoAnswered.length,
    duration: formatDuration(totalDuration),
  });

  return {
    pageNumber,
    timings: {
      questionGeneration: questionDuration,
      total: totalDuration,
    },
    fieldsProcessed: fields.length,
    questionsGenerated: result.questions.length,
    autoAnswered: result.autoAnswered.length,
  };
}

// Process multiple pages sequentially (maintaining conversation context)
export async function processPages(
  documentId: string,
  userId: string,
  pages: Array<{
    pageNumber: number;
    imageBase64: string;
    fields: ExtractedField[];
  }>
): Promise<PageProcessingResult[]> {
  const results: PageProcessingResult[] = [];
  const totalTimer = new StepTimer(documentId, `All Pages (${pages.length})`);

  for (const page of pages) {
    const result = await processPage({
      documentId,
      userId,
      pageNumber: page.pageNumber,
      pageImageBase64: page.imageBase64,
      fields: page.fields,
    });
    results.push(result);
  }

  const totalQuestions = results.reduce((sum, r) => sum + r.questionsGenerated, 0);
  const totalAutoAnswered = results.reduce((sum, r) => sum + r.autoAnswered, 0);
  const totalDuration = totalTimer.end({
    pagesProcessed: pages.length,
    totalQuestions,
    totalAutoAnswered,
  });

  console.log(`[AutoForm] All pages complete:`, {
    documentId,
    pagesProcessed: pages.length,
    totalQuestions,
    totalAutoAnswered,
    totalDuration: formatDuration(totalDuration),
    perPage: results.map((r) => ({
      page: r.pageNumber,
      questions: r.questionsGenerated,
      duration: formatDuration(r.timings.total),
    })),
  });

  return results;
}
