// Per-page processing pipeline - OPTIMIZED FOR USER EXPERIENCE
//
// Flow:
// 1. Parse PDF → Display fields immediately (user can edit)
// 2. Generate initial questions (user can start answering)
// 3. Create composite image (background)
// 4. Call Gemini Vision for QC (background)
// 5. Apply field adjustments (background)
// 6. Update visible fields (with "Enhancing" loader)
// 7. Adjust questions based on finalized fields

import { reviewFieldsWithVision, generateQuestionsForPage } from "../gemini/vision";
import { compositeFieldsOntoImage } from "../image-compositor";
import { uploadCompositeImage } from "../storage";
import {
  updateProcessingProgress,
  appendToConversation,
  getConversationHistory,
  saveQuestion,
  batchUpdateFieldValues,
  updateQuestion,
} from "./state";
import { createAdminClient } from "../supabase/admin";
import { StepTimer, formatDuration } from "../timing";
import type { ExtractedField, FieldType, NormalizedCoordinates } from "../types";

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
    initialQuestions: number;
    compositing: number;
    geminiVision: number;
    fieldUpdates: number;
    questionAdjustments: number;
    total: number;
  };
  fieldsReviewed: number;
  fieldsAdded: number;
  fieldsAdjusted: number;
  fieldsRemoved: number;
  questionsGenerated: number;
  questionsAdjusted: number;
  compositeStoragePath: string;
}

export async function processPage(
  params: ProcessPageParams
): Promise<PageProcessingResult> {
  const { documentId, userId, pageNumber, pageImageBase64, fields } = params;
  const supabase = createAdminClient();
  const totalTimer = new StepTimer(documentId, `Page ${pageNumber} Total Processing`);

  // Fetch context notes and QC status from document
  const { data: doc } = await supabase
    .from("documents")
    .select("context_notes, fields_qc_complete")
    .eq("id", documentId)
    .single();
  const contextNotes = doc?.context_notes || undefined;
  const fieldsAlreadyQCd = doc?.fields_qc_complete || false;

  console.log(`[AutoForm] ==========================================`);
  console.log(`[AutoForm] Processing page ${pageNumber}:`, {
    documentId,
    fieldCount: fields.length,
    fieldsAlreadyQCd,
    mode: fieldsAlreadyQCd ? "questions-only" : fields.length > 0 ? "QC" : "full-detection",
  });
  console.log(`[AutoForm] ==========================================`);

  // ============================================================
  // STEP 1: Generate initial questions IMMEDIATELY (if fields exist)
  // (User can start answering while enhancement runs)
  // If no Document AI fields, skip - we'll generate after Gemini Vision detects them
  // ============================================================
  const step1Timer = new StepTimer(documentId, `Step 1: Initial Question Generation (Page ${pageNumber})`);

  let initialQuestionResult: { questions: Array<{ question: string; fieldIds: string[]; inputType: FieldType; profileKey?: string }>; autoAnswered: Array<{ fieldId: string; value: string }> } = {
    questions: [],
    autoAnswered: [],
  };

  if (fields.length > 0) {
    // Only generate questions if we have Document AI fields with valid UUIDs
    const conversationHistory = await getConversationHistory(documentId);
    initialQuestionResult = await generateQuestionsForPage({
      documentId,
      pageNumber,
      pageImageBase64,
      fields,
      conversationHistory,
      contextNotes,
    });

    // Save initial questions to database
    for (const q of initialQuestionResult.questions) {
      await saveQuestion(documentId, {
        question: q.question,
        fieldIds: q.fieldIds,
        inputType: q.inputType,
        profileKey: q.profileKey,
        pageNumber,
      });
    }

    // Apply any auto-answered fields from initial pass
    if (initialQuestionResult.autoAnswered.length > 0) {
      await batchUpdateFieldValues(
        initialQuestionResult.autoAnswered.map((a) => ({
          fieldId: a.fieldId,
          value: a.value,
        }))
      );
    }
  } else {
    console.log(`[AutoForm] Skipping initial questions for page ${pageNumber} - no Document AI fields, will generate after Gemini Vision detection`);
  }

  const step1Duration = step1Timer.end({
    questionsGenerated: initialQuestionResult.questions.length,
    autoAnswered: initialQuestionResult.autoAnswered.length,
    skipped: fields.length === 0,
  });

  // ============================================================
  // STEPS 2-4: Only run if fields haven't been QC'd yet
  // (QC now runs separately via refine-fields route)
  // ============================================================
  let step2Duration = 0;
  let step3Duration = 0;
  let step4Duration = 0;
  let fieldsAdjusted = 0;
  let fieldsAdded = 0;
  let fieldsRemoved = 0;
  let compositeStoragePath = "";
  const newFieldRecords: ExtractedField[] = [];
  const removedFieldIds: string[] = [];

  if (!fieldsAlreadyQCd) {
    // ============================================================
    // STEP 2: Create composite image
    // ============================================================
    const step2Timer = new StepTimer(documentId, `Step 2: Composite Image Creation (Page ${pageNumber})`);

    const composited = await compositeFieldsOntoImage({
      imageBase64: pageImageBase64,
      fields,
      showGrid: true,
      gridSpacing: 10,
    });

    compositeStoragePath = await uploadCompositeImage(
      userId,
      documentId,
      pageNumber,
      composited.imageBase64
    );

    step2Duration = step2Timer.end({
      dimensions: `${composited.width}x${composited.height}`,
      storagePath: compositeStoragePath,
    });

    // ============================================================
    // STEP 3: Call Gemini Vision for field review/QC
    // ============================================================
    const step3Timer = new StepTimer(documentId, `Step 3: Gemini Vision QC (Page ${pageNumber})`);

    const reviewResult = await reviewFieldsWithVision({
      documentId,
      pageNumber,
      pageImageBase64,
      fields,
    });

    step3Duration = step3Timer.end({
      adjustments: reviewResult.adjustments.length,
      newFields: reviewResult.newFields.length,
      removeFields: reviewResult.removeFields.length,
      validated: reviewResult.fieldsValidated,
    });

    // ============================================================
    // STEP 4: Apply field adjustments to database
    // ============================================================
    const step4Timer = new StepTimer(documentId, `Step 4: Apply Field Adjustments (Page ${pageNumber})`);

    // Apply adjustments to existing fields
    for (const adj of reviewResult.adjustments) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        // Mark as enhanced by Gemini so it shows in UI
        detection_source: "gemini_vision",
      };

      if (adj.changes.label) updates.label = adj.changes.label;
      if (adj.changes.fieldType) updates.field_type = adj.changes.fieldType;
      if (adj.changes.coordinates) updates.coordinates = adj.changes.coordinates;

      const { error } = await supabase
        .from("extracted_fields")
        .update(updates)
        .eq("id", adj.fieldId);

      if (!error) fieldsAdjusted++;
    }

    // Mark all fields on this page as reviewed by Gemini (even if no changes)
    // This allows them to be shown in the UI
    if (reviewResult.fieldsValidated && fields.length > 0) {
      const fieldIds = fields.map((f) => f.id);
      await supabase
        .from("extracted_fields")
        .update({
          detection_source: "gemini_vision",
          updated_at: new Date().toISOString(),
        })
        .in("id", fieldIds);
    }

    // Add new fields identified by Gemini
    for (const newField of reviewResult.newFields) {
      const now = new Date().toISOString();
      const fieldRecord: ExtractedField = {
        id: crypto.randomUUID(),
        document_id: documentId,
        page_number: pageNumber,
        field_index: fields.length + newFieldRecords.length,
        label: newField.label,
        field_type: newField.fieldType,
        coordinates: newField.coordinates,
        value: null,
        ai_suggested_value: null,
        ai_confidence: null,
        help_text: null,
        detection_source: "gemini_vision",
        confidence_score: null,
        manually_adjusted: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };

      const { error } = await supabase
        .from("extracted_fields")
        .insert(fieldRecord);

      if (!error) {
        newFieldRecords.push(fieldRecord);
        fieldsAdded++;
      }
    }

    // Soft delete removed fields
    for (const fieldId of reviewResult.removeFields) {
      const { error } = await supabase
        .from("extracted_fields")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", fieldId);

      if (!error) {
        fieldsRemoved++;
        removedFieldIds.push(fieldId);
      }
    }

    step4Duration = step4Timer.end({
      fieldsAdjusted,
      fieldsAdded,
      fieldsRemoved,
    });
  } else {
    console.log(`[AutoForm] Skipping QC steps 2-4 for page ${pageNumber} - fields already QC'd`);
  }

  // ============================================================
  // STEP 5: Generate/Adjust questions based on finalized fields
  // - Full-detection mode: Generate questions for ALL new fields
  // - QC mode: Generate questions only for newly added fields
  // ============================================================
  const step5Timer = new StepTimer(documentId, `Step 5: Question Generation (Page ${pageNumber})`);

  let questionsGenerated = 0;

  // Generate questions if:
  // 1. QC already done - generate for all existing fields (normal flow after context submission)
  // 2. Full-detection mode (no initial Document AI fields) - generate for all detected fields
  // 3. QC mode but new fields were added by Gemini Vision
  const needsQuestionGeneration = fieldsAlreadyQCd || fields.length === 0 || newFieldRecords.length > 0;
  // When QC is already done, generate questions for all existing fields
  // Otherwise, generate only for newly detected fields
  const fieldsForQuestions = fieldsAlreadyQCd ? fields : (fields.length === 0 ? newFieldRecords : newFieldRecords);

  if (needsQuestionGeneration && fieldsForQuestions.length > 0) {
    console.log(`[AutoForm] Generating questions for ${fieldsForQuestions.length} fields:`, {
      documentId,
      pageNumber,
      mode: fieldsAlreadyQCd ? "post-context" : (fields.length === 0 ? "full-detection" : "new-fields-only"),
    });

    const generatedQuestions = await generateQuestionsForPage({
      documentId,
      pageNumber,
      pageImageBase64,
      fields: fieldsForQuestions,
      conversationHistory: await getConversationHistory(documentId),
      contextNotes,
    });

    for (const q of generatedQuestions.questions) {
      await saveQuestion(documentId, {
        question: q.question,
        fieldIds: q.fieldIds,
        inputType: q.inputType,
        profileKey: q.profileKey,
        pageNumber,
      });
      questionsGenerated++;
    }

    // Apply any auto-answered fields
    if (generatedQuestions.autoAnswered.length > 0) {
      await batchUpdateFieldValues(
        generatedQuestions.autoAnswered.map((a) => ({
          fieldId: a.fieldId,
          value: a.value,
        }))
      );
    }
  }

  // If fields were removed, hide questions that reference only removed fields
  let questionsHidden = 0;
  if (removedFieldIds.length > 0) {
    const { data: affectedQuestions } = await supabase
      .from("document_questions")
      .select("id, field_ids")
      .eq("document_id", documentId)
      .eq("page_number", pageNumber);

    for (const q of affectedQuestions || []) {
      const fieldIds = q.field_ids as string[];
      const allFieldsRemoved = fieldIds.every((id) =>
        removedFieldIds.includes(id)
      );

      if (allFieldsRemoved) {
        await updateQuestion(q.id, { status: "hidden" });
        questionsHidden++;
      }
    }
  }

  const step5Duration = step5Timer.end({
    questionsGenerated,
    mode: fieldsAlreadyQCd ? "post-context" : (fields.length === 0 ? "full-detection" : "qc"),
    fieldsCount: fieldsForQuestions.length,
  });

  // ============================================================
  // COMPLETE
  // ============================================================
  const totalDuration = totalTimer.end({
    fieldsReviewed: fields.length,
    fieldsAdded,
    fieldsAdjusted,
    fieldsRemoved,
    initialQuestionsGenerated: initialQuestionResult.questions.length,
    step5QuestionsGenerated: questionsGenerated,
  });

  console.log(`[AutoForm] ==========================================`);
  console.log(`[AutoForm] Page ${pageNumber} TIMING SUMMARY:`, {
    documentId,
    step1_initialQuestions: formatDuration(step1Duration),
    step2_compositing: formatDuration(step2Duration),
    step3_geminiVision: formatDuration(step3Duration),
    step4_fieldUpdates: formatDuration(step4Duration),
    step5_questionAdjustments: formatDuration(step5Duration),
    total: formatDuration(totalDuration),
  });
  console.log(`[AutoForm] ==========================================`);

  return {
    pageNumber,
    timings: {
      initialQuestions: step1Duration,
      compositing: step2Duration,
      geminiVision: step3Duration,
      fieldUpdates: step4Duration,
      questionAdjustments: step5Duration,
      total: totalDuration,
    },
    fieldsReviewed: fields.length,
    fieldsAdded,
    fieldsAdjusted,
    fieldsRemoved,
    questionsGenerated: initialQuestionResult.questions.length + questionsGenerated,
    questionsAdjusted: 0, // Deprecated, keeping for interface compatibility
    compositeStoragePath,
  };
}

// Process multiple pages sequentially (maintaining context)
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
  const totalTimer = new StepTimer(documentId, `All Pages Processing (${pages.length} pages)`);

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

  const totalDuration = totalTimer.end({
    pagesProcessed: pages.length,
    totalQuestions: results.reduce((sum, r) => sum + r.questionsGenerated, 0),
    totalFieldsAdded: results.reduce((sum, r) => sum + r.fieldsAdded, 0),
  });

  // Log overall timing summary
  console.log(`[AutoForm] ==========================================`);
  console.log(`[AutoForm] ALL PAGES TIMING SUMMARY:`, {
    documentId,
    pagesProcessed: pages.length,
    totalDuration: formatDuration(totalDuration),
    avgPerPage: formatDuration(Math.round(totalDuration / pages.length)),
    breakdown: results.map((r) => ({
      page: r.pageNumber,
      total: formatDuration(r.timings.total),
    })),
  });
  console.log(`[AutoForm] ==========================================`);

  return results;
}
