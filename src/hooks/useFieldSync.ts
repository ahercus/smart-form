"use client";

import { useState, useCallback, useMemo } from "react";
import type { ExtractedField, QuestionGroup } from "@/lib/types";

interface UseFieldSyncParams {
  fields: ExtractedField[];
  questions: QuestionGroup[];
  documentId: string;
}

export function useFieldSync({
  fields,
  questions,
  documentId,
}: UseFieldSyncParams) {
  const [localFieldValues, setLocalFieldValues] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());

  // Build a map of field values (local overrides server)
  const fieldValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.id] = localFieldValues[field.id] ?? field.value ?? "";
    }
    return values;
  }, [fields, localFieldValues]);

  // Find question for a field
  const getQuestionForField = useCallback(
    (fieldId: string): QuestionGroup | undefined => {
      return questions.find((q) => q.field_ids.includes(fieldId));
    },
    [questions]
  );

  // Update a field value locally (optimistic update)
  const updateFieldValue = useCallback((fieldId: string, value: string) => {
    setLocalFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    setPendingUpdates((prev) => new Set([...prev, fieldId]));
  }, []);

  // Save pending field updates to server
  const saveFieldUpdates = useCallback(async () => {
    if (pendingUpdates.size === 0) return;

    setSaving(true);
    const updates = Array.from(pendingUpdates).map((fieldId) => ({
      field_id: fieldId,
      value: localFieldValues[fieldId] || "",
    }));

    try {
      const response = await fetch(`/api/documents/${documentId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (!response.ok) {
        throw new Error("Failed to save fields");
      }

      console.log("[AutoForm] Fields saved:", { count: updates.length });
      setPendingUpdates(new Set());
    } catch (error) {
      console.error("[AutoForm] Failed to save fields:", error);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [documentId, localFieldValues, pendingUpdates]);

  // Handle field change with question sync
  const onFieldChange = useCallback(
    async (fieldId: string, value: string) => {
      // Update local state immediately
      updateFieldValue(fieldId, value);

      // Check if this field is linked to a question
      const question = getQuestionForField(fieldId);
      if (question && question.status === "visible") {
        // If user manually fills a field, we should update the question status
        // This is handled via the API when field is saved
        console.log("[AutoForm] Field change linked to question:", {
          fieldId,
          questionId: question.id,
          hasValue: value.trim().length > 0,
        });
      }
    },
    [updateFieldValue, getQuestionForField]
  );

  // Check if a field has unsaved changes
  const hasUnsavedChanges = useMemo(
    () => pendingUpdates.size > 0,
    [pendingUpdates]
  );

  // Get field by ID
  const getField = useCallback(
    (fieldId: string): ExtractedField | undefined => {
      return fields.find((f) => f.id === fieldId);
    },
    [fields]
  );

  // Get fields for a page
  const getFieldsForPage = useCallback(
    (pageNumber: number): ExtractedField[] => {
      return fields.filter((f) => f.page_number === pageNumber);
    },
    [fields]
  );

  // Calculate completion stats
  const completionStats = useMemo(() => {
    const total = fields.length;
    const filled = fields.filter((f) => {
      const value = fieldValues[f.id];
      return value && value.trim().length > 0;
    }).length;
    return {
      total,
      filled,
      percentage: total > 0 ? (filled / total) * 100 : 0,
    };
  }, [fields, fieldValues]);

  return {
    fieldValues,
    updateFieldValue,
    onFieldChange,
    saveFieldUpdates,
    saving,
    hasUnsavedChanges,
    pendingUpdates: pendingUpdates.size,
    getField,
    getFieldsForPage,
    getQuestionForField,
    completionStats,
  };
}
