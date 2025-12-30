"use client";

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type {
  Document,
  ExtractedField,
  ProcessingProgress,
  QuestionGroup,
} from "@/lib/types";

interface DocumentRealtimeState {
  document: Document | null;
  fields: ExtractedField[];
  questions: QuestionGroup[];
  progress: ProcessingProgress | null;
  loading: boolean;
  error: string | null;
}

export function useDocumentRealtime(documentId: string) {
  const [state, setState] = useState<DocumentRealtimeState>({
    document: null,
    fields: [],
    questions: [],
    progress: null,
    loading: true,
    error: null,
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Validate documentId is a valid UUID
  const isValidId = documentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);

  // Initial data fetch
  const fetchData = useCallback(async () => {
    if (!isValidId) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Invalid document ID",
      }));
      return;
    }

    try {
      // Fetch document
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .single();

      if (docError) throw docError;

      // Fetch fields
      const { data: fields, error: fieldsError } = await supabase
        .from("extracted_fields")
        .select("*")
        .eq("document_id", documentId)
        .is("deleted_at", null)
        .order("page_number")
        .order("field_index");

      if (fieldsError) throw fieldsError;

      // Fetch questions (exclude hidden questions)
      const { data: questions, error: questionsError } = await supabase
        .from("document_questions")
        .select("*")
        .eq("document_id", documentId)
        .neq("status", "hidden")
        .order("page_number")
        .order("created_at");

      if (questionsError) throw questionsError;

      setState({
        document: doc as Document,
        fields: (fields || []) as ExtractedField[],
        questions: (questions || []).map((q) => ({
          id: q.id,
          document_id: q.document_id,
          question: q.question,
          field_ids: q.field_ids,
          input_type: q.input_type,
          profile_key: q.profile_key,
          page_number: q.page_number,
          status: q.status,
          answer: q.answer,
          choices: q.choices,
          created_at: q.created_at,
          updated_at: q.updated_at,
        })) as QuestionGroup[],
        progress: doc?.processing_progress as ProcessingProgress | null,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error("[AutoForm] Failed to fetch document data:", error);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load",
      }));
    }
  }, [documentId, isValidId, supabase]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!isValidId) return;

    fetchData();

    // Subscribe to document changes
    const documentChannel = supabase
      .channel(`document-${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `id=eq.${documentId}`,
        },
        (payload) => {
          console.log("[AutoForm] Document changed:", payload);
          if (payload.eventType === "UPDATE") {
            setState((prev) => ({
              ...prev,
              document: payload.new as Document,
              progress: payload.new.processing_progress as ProcessingProgress,
            }));
          }
        }
      )
      .subscribe();

    // Subscribe to field changes
    const fieldsChannel = supabase
      .channel(`fields-${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "extracted_fields",
          filter: `document_id=eq.${documentId}`,
        },
        (payload) => {
          console.log("[AutoForm] Field changed:", payload);
          if (payload.eventType === "INSERT") {
            setState((prev) => ({
              ...prev,
              fields: [...prev.fields, payload.new as ExtractedField],
            }));
          } else if (payload.eventType === "UPDATE") {
            const updatedField = payload.new as ExtractedField;
            setState((prev) => ({
              ...prev,
              // Filter out soft-deleted fields, update others
              fields: updatedField.deleted_at
                ? prev.fields.filter((f) => f.id !== updatedField.id)
                : prev.fields.map((f) =>
                    f.id === updatedField.id ? updatedField : f
                  ),
            }));
          } else if (payload.eventType === "DELETE") {
            setState((prev) => ({
              ...prev,
              fields: prev.fields.filter((f) => f.id !== payload.old.id),
            }));
          }
        }
      )
      .subscribe();

    // Subscribe to question changes
    // Handle: INSERT (new questions stream in), UPDATE (status changes, hidden questions)
    const questionsChannel = supabase
      .channel(`questions-${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_questions",
          filter: `document_id=eq.${documentId}`,
        },
        (payload) => {
          console.log("[AutoForm] Question changed:", payload);
          if (payload.eventType === "INSERT") {
            const newQuestion = payload.new;
            // Don't add hidden questions
            if (newQuestion.status === "hidden") {
              console.log("[AutoForm] Ignoring hidden question:", newQuestion.id);
              return;
            }
            console.log("[AutoForm] New question arrived via Realtime:", {
              id: newQuestion.id,
              question: newQuestion.question?.substring(0, 50),
            });
            setState((prev) => ({
              ...prev,
              questions: [
                ...prev.questions,
                {
                  id: newQuestion.id,
                  document_id: newQuestion.document_id,
                  question: newQuestion.question,
                  field_ids: newQuestion.field_ids,
                  input_type: newQuestion.input_type,
                  profile_key: newQuestion.profile_key,
                  page_number: newQuestion.page_number,
                  status: newQuestion.status,
                  answer: newQuestion.answer,
                  choices: newQuestion.choices,
                  created_at: newQuestion.created_at,
                  updated_at: newQuestion.updated_at,
                } as QuestionGroup,
              ],
            }));
          } else if (payload.eventType === "UPDATE") {
            const updatedQuestion = payload.new;
            // If question was marked hidden, remove it from the list
            if (updatedQuestion.status === "hidden") {
              console.log("[AutoForm] Question hidden (QC reconciliation):", updatedQuestion.id);
              setState((prev) => ({
                ...prev,
                questions: prev.questions.filter((q) => q.id !== updatedQuestion.id),
              }));
            } else {
              // Update in place
              setState((prev) => ({
                ...prev,
                questions: prev.questions.map((q) =>
                  q.id === updatedQuestion.id
                    ? ({
                        id: updatedQuestion.id,
                        document_id: updatedQuestion.document_id,
                        question: updatedQuestion.question,
                        field_ids: updatedQuestion.field_ids,
                        input_type: updatedQuestion.input_type,
                        profile_key: updatedQuestion.profile_key,
                        page_number: updatedQuestion.page_number,
                        status: updatedQuestion.status,
                        answer: updatedQuestion.answer,
                        choices: updatedQuestion.choices,
                        created_at: updatedQuestion.created_at,
                        updated_at: updatedQuestion.updated_at,
                      } as QuestionGroup)
                    : q
                ),
              }));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(documentChannel);
      supabase.removeChannel(fieldsChannel);
      supabase.removeChannel(questionsChannel);
    };
  }, [documentId, isValidId, fetchData, supabase]);

  const refetch = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch,
  };
}
