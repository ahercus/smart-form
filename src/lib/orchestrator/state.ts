// Supabase state read/write helpers for the orchestrator

import { createAdminClient } from "../supabase/admin";
import type {
  ProcessingProgress,
  QuestionGroup,
  FieldType,
  MemoryChoice,
} from "../types";

// Retry helper for transient network errors
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; context?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, context = "operation" } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isTransient =
        lastError.message.includes("fetch failed") ||
        lastError.message.includes("TIMEOUT") ||
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("ENOTFOUND");

      if (!isTransient || attempt === maxRetries) {
        throw lastError;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`[AutoForm] Retrying ${context} (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Update processing progress
export async function updateProcessingProgress(
  documentId: string,
  progress: Partial<ProcessingProgress>
): Promise<void> {
  const supabase = createAdminClient();

  // Get current progress
  const { data: doc } = await supabase
    .from("documents")
    .select("processing_progress")
    .eq("id", documentId)
    .single();

  const currentProgress = (doc?.processing_progress as ProcessingProgress) || {
    phase: "idle",
    pagesTotal: 0,
    pagesComplete: 0,
    questionsDelivered: 0,
  };

  const newProgress = { ...currentProgress, ...progress };

  const { error } = await supabase
    .from("documents")
    .update({
      processing_progress: newProgress,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    console.error("[AutoForm] Failed to update processing progress:", error);
    throw error;
  }

  console.log("[AutoForm] Processing progress updated:", {
    documentId,
    progress: newProgress,
  });
}

// Get processing progress
export async function getProcessingProgress(
  documentId: string
): Promise<ProcessingProgress> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .select("processing_progress")
    .eq("id", documentId)
    .single();

  if (error) {
    throw error;
  }

  return (data?.processing_progress as ProcessingProgress) || {
    phase: "idle",
    pagesTotal: 0,
    pagesComplete: 0,
    questionsDelivered: 0,
  };
}

// Save a question to the database (with retry for transient errors)
export async function saveQuestion(
  documentId: string,
  question: {
    question: string;
    fieldIds: string[];
    inputType: FieldType;
    profileKey?: string;
    pageNumber: number;
    choices?: MemoryChoice[];
    status?: QuestionGroup["status"]; // Default: "visible"
  }
): Promise<QuestionGroup> {
  return withRetry(
    async () => {
      const supabase = createAdminClient();

      const { data, error } = await supabase
        .from("document_questions")
        .insert({
          document_id: documentId,
          question: question.question,
          field_ids: question.fieldIds,
          input_type: question.inputType,
          profile_key: question.profileKey || null,
          page_number: question.pageNumber,
          status: question.status || "visible",
          choices: question.choices || null,
        })
        .select()
        .single();

      if (error) {
        console.error("[AutoForm] Failed to save question:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message);
      }

      console.log("[AutoForm] Question saved:", {
        documentId,
        questionId: data.id,
        question: question.question.slice(0, 50),
        hasChoices: !!question.choices?.length,
      });

      return {
        id: data.id,
        document_id: data.document_id,
        question: data.question,
        field_ids: data.field_ids,
        input_type: data.input_type as FieldType,
        profile_key: data.profile_key,
        page_number: data.page_number,
        status: data.status,
        answer: data.answer,
        choices: data.choices as MemoryChoice[] | undefined,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    },
    { context: "saveQuestion", maxRetries: 3 }
  );
}

// Get all questions for a document
export async function getQuestions(
  documentId: string
): Promise<QuestionGroup[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("document_questions")
    .select("*")
    .eq("document_id", documentId)
    .order("page_number")
    .order("created_at");

  if (error) {
    throw error;
  }

  return (data || []).map((q) => ({
    id: q.id,
    document_id: q.document_id,
    question: q.question,
    field_ids: q.field_ids,
    input_type: q.input_type as FieldType,
    profile_key: q.profile_key,
    page_number: q.page_number,
    status: q.status as QuestionGroup["status"],
    answer: q.answer,
    choices: q.choices as MemoryChoice[] | undefined,
    created_at: q.created_at,
    updated_at: q.updated_at,
  }));
}

// Update a question
export async function updateQuestion(
  questionId: string,
  updates: Partial<Pick<QuestionGroup, "status" | "answer" | "question" | "field_ids">>
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("document_questions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", questionId);

  if (error) {
    console.error("[AutoForm] Failed to update question:", error);
    throw error;
  }
}

// Update field value
export async function updateFieldValue(
  fieldId: string,
  value: string
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("extracted_fields")
    .update({
      value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fieldId);

  if (error) {
    console.error("[AutoForm] Failed to update field value:", error);
    throw error;
  }
}

// Batch update field values
export async function batchUpdateFieldValues(
  updates: Array<{ fieldId: string; value: string }>
): Promise<void> {
  return withRetry(
    async () => {
      const supabase = createAdminClient();

      // Supabase doesn't support batch updates directly, so we do them in parallel
      await Promise.all(
        updates.map(({ fieldId, value }) =>
          supabase
            .from("extracted_fields")
            .update({ value, updated_at: new Date().toISOString() })
            .eq("id", fieldId)
        )
      );

      console.log("[AutoForm] Batch field update complete:", {
        count: updates.length,
      });
    },
    { context: "batchUpdateFieldValues", maxRetries: 3 }
  );
}
