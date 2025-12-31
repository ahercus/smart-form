// Field refinement - runs Gemini QC on fields WITHOUT generating questions
// This runs immediately after Azure DI, before user submits context
//
// QC RECONCILIATION:
// After QC completes, if questions were already generated (optimistic rendering),
// we need to reconcile:
// - If QC added fields -> generate questions for them
// - If QC removed fields -> hide their questions
// - If QC adjusted fields -> no action needed (questions still valid)

import { reviewFieldsWithVision, generateQuestionsForPage } from "../gemini/vision";
import { createAdminClient } from "../supabase/admin";
import { getConversationHistory, saveQuestion } from "./state";
import type { ExtractedField } from "../types";

interface RefineFieldsParams {
  documentId: string;
  userId: string;
  pageImages: Array<{
    pageNumber: number;
    imageBase64: string;
  }>;
}

export interface FieldRefinementResult {
  success: boolean;
  fieldsAdjusted: number;
  fieldsAdded: number;
  fieldsRemoved: number;
  questionsGenerated: number;
  questionsHidden: number;
  error?: string;
}

export async function refineFields(
  params: RefineFieldsParams
): Promise<FieldRefinementResult> {
  const { documentId, userId, pageImages } = params;
  const supabase = createAdminClient();

  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] Field refinement starting:", {
    documentId,
    pageCount: pageImages.length,
  });
  console.log("[AutoForm] ==========================================");

  try {
    // Update status to refining
    await supabase
      .from("documents")
      .update({ status: "refining" })
      .eq("id", documentId);

    // Get existing fields from database
    const { data: allFields, error: fieldsError } = await supabase
      .from("extracted_fields")
      .select("*")
      .eq("document_id", documentId)
      .is("deleted_at", null)
      .order("page_number")
      .order("field_index");

    if (fieldsError) {
      throw new Error(`Failed to get fields: ${fieldsError.message}`);
    }

    let totalAdjusted = 0;
    let totalAdded = 0;
    let totalRemoved = 0;

    // Process each page
    for (const pageImage of pageImages) {
      const { pageNumber, imageBase64 } = pageImage;
      const pageFields = allFields?.filter((f) => f.page_number === pageNumber) || [];

      console.log(`[AutoForm] Refining page ${pageNumber}:`, {
        documentId,
        fieldCount: pageFields.length,
      });

      if (pageFields.length === 0) {
        console.log(`[AutoForm] No fields on page ${pageNumber}, skipping QC`);
        continue;
      }

      // Call Gemini Vision for field review (it creates its own composite internally)
      const qcStartTime = Date.now();
      const reviewResult = await reviewFieldsWithVision({
        documentId,
        pageNumber,
        pageImageBase64: imageBase64,
        fields: pageFields as ExtractedField[],
      });
      const qcDuration = Date.now() - qcStartTime;

      // Apply adjustments
      const { adjustments, newFields, removeFields } = reviewResult;

      // Log QC summary with timing
      console.log(`[AutoForm] QC Results for page ${pageNumber}:`, {
        documentId,
        duration: `${(qcDuration / 1000).toFixed(1)}s`,
        fieldsReviewed: pageFields.length,
        adjustments: adjustments.length,
        newFields: newFields.length,
        removals: removeFields.length,
      });

      // Log detailed adjustments for debugging
      if (adjustments.length > 0) {
        const adjustmentDetails = adjustments.map(adj => {
          const originalField = pageFields.find(f => f.id === adj.fieldId);
          const orig = originalField?.coordinates;
          const newC = adj.changes?.coordinates;

          // Format coordinate changes as readable strings
          let coordChange = null;
          if (newC && orig) {
            const topDelta = (newC.top - orig.top).toFixed(1);
            const leftDelta = (newC.left - orig.left).toFixed(1);
            const heightDelta = (newC.height - orig.height).toFixed(1);
            coordChange = `top: ${orig.top.toFixed(1)}→${newC.top.toFixed(1)} (${topDelta}), ` +
                          `left: ${orig.left.toFixed(1)}→${newC.left.toFixed(1)} (${leftDelta}), ` +
                          `height: ${orig.height.toFixed(1)}→${newC.height.toFixed(1)} (${heightDelta})`;
          }

          return {
            field: originalField?.label || adj.fieldId.slice(0, 8),
            label: adj.changes?.label ? `→ "${adj.changes.label}"` : null,
            type: adj.changes?.fieldType ? `→ ${adj.changes.fieldType}` : null,
            coords: coordChange,
          };
        }).filter(a => a.label || a.type || a.coords);

        console.log(`[AutoForm] QC Adjustments (page ${pageNumber}):`);
        adjustmentDetails.forEach(a => {
          console.log(`  - ${a.field}:`, a.coords || a.label || a.type);
        });
      }

      // Log new fields added
      if (newFields.length > 0) {
        console.log(`[AutoForm] QC New Fields (page ${pageNumber}):`,
          newFields.map(f => ({
            label: f.label,
            type: f.fieldType,
            coords: `(${f.coordinates.left.toFixed(1)}%, ${f.coordinates.top.toFixed(1)}%)`,
          }))
        );
      }

      // Log removed fields
      if (removeFields.length > 0) {
        console.log(`[AutoForm] QC Removed Fields (page ${pageNumber}):`,
          removeFields.map(id => {
            const field = pageFields.find(f => f.id === id);
            return { id: id.slice(0, 8) + "...", label: field?.label };
          })
        );
      }

      // Update existing fields
      for (const adj of adjustments) {
        if (adj.action === "update" && adj.changes) {
          const updateData: Record<string, unknown> = {
            detection_source: "gemini_refinement",
            updated_at: new Date().toISOString(),
          };

          if (adj.changes.label) updateData.label = adj.changes.label;
          if (adj.changes.fieldType) updateData.field_type = adj.changes.fieldType;
          if (adj.changes.coordinates) updateData.coordinates = adj.changes.coordinates;
          if (adj.changes.choiceOptions) updateData.choice_options = adj.changes.choiceOptions;

          await supabase
            .from("extracted_fields")
            .update(updateData)
            .eq("id", adj.fieldId);

          totalAdjusted++;
        }
      }

      // Add new fields
      for (const newField of newFields) {
        const insertData: Record<string, unknown> = {
          document_id: documentId,
          page_number: pageNumber,
          field_index: pageFields.length + newFields.indexOf(newField),
          label: newField.label,
          field_type: newField.fieldType,
          coordinates: newField.coordinates,
          detection_source: "gemini_vision",
        };

        // Add choice_options for circle_choice fields
        if (newField.choiceOptions) {
          insertData.choice_options = newField.choiceOptions;
        }

        const { error: insertError } = await supabase
          .from("extracted_fields")
          .insert(insertData);

        if (!insertError) {
          totalAdded++;
        }
      }

      // Soft-delete removed fields
      for (const fieldId of removeFields) {
        await supabase
          .from("extracted_fields")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", fieldId);

        totalRemoved++;
      }

      console.log(`[AutoForm] Page ${pageNumber} QC applied to database`);
    }

    // Mark fields as QC complete AND set status to ready
    // This is when fields should be shown to the user
    await supabase
      .from("documents")
      .update({
        fields_qc_complete: true,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Document marked ready after QC:", { documentId });

    // QC RECONCILIATION: Handle questions if they were already generated
    // This happens when questions were generated optimistically from Azure fields
    let questionsGenerated = 0;
    let questionsHidden = 0;

    // Check if questions were already generated (context was submitted)
    const { data: doc } = await supabase
      .from("documents")
      .select("context_submitted")
      .eq("id", documentId)
      .single();

    if (doc?.context_submitted) {
      console.log("[AutoForm] QC reconciliation needed - questions already generated");

      // Get all newly added fields for reconciliation
      if (totalAdded > 0) {
        const { data: newFields } = await supabase
          .from("extracted_fields")
          .select("*")
          .eq("document_id", documentId)
          .eq("detection_source", "gemini_vision")
          .is("deleted_at", null);

        if (newFields && newFields.length > 0) {
          questionsGenerated = await generateQuestionsForNewFields(
            documentId,
            userId,
            newFields as ExtractedField[]
          );
        }
      }

      // Hide questions for removed fields
      if (totalRemoved > 0) {
        // Get all removed field IDs from the pageImages we processed
        const { data: removedFields } = await supabase
          .from("extracted_fields")
          .select("id")
          .eq("document_id", documentId)
          .not("deleted_at", "is", null);

        if (removedFields && removedFields.length > 0) {
          const removedFieldIds = removedFields.map((f) => f.id);
          questionsHidden = await hideQuestionsForFields(documentId, removedFieldIds);
        }
      }
    }

    console.log("[AutoForm] ==========================================");
    console.log("[AutoForm] Field refinement complete:", {
      documentId,
      totalAdjusted,
      totalAdded,
      totalRemoved,
      questionsGenerated,
      questionsHidden,
    });
    console.log("[AutoForm] ==========================================");

    return {
      success: true,
      fieldsAdjusted: totalAdjusted,
      fieldsAdded: totalAdded,
      fieldsRemoved: totalRemoved,
      questionsGenerated,
      questionsHidden,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Field refinement failed (graceful degradation):", {
      documentId,
      error: errorMessage,
    });

    // GRACEFUL DEGRADATION: Mark QC as complete and document as ready
    // Azure DI fields are still usable even without Gemini refinement
    await supabase
      .from("documents")
      .update({
        fields_qc_complete: true,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Document marked ready despite QC failure:", {
      documentId,
      reason: "Azure DI fields are still usable (graceful degradation)",
    });

    return {
      success: true, // Partial success - fields exist, just not refined
      fieldsAdjusted: 0,
      fieldsAdded: 0,
      fieldsRemoved: 0,
      questionsGenerated: 0,
      questionsHidden: 0,
      error: errorMessage,
    };
  }
}

/**
 * Generate questions for fields that QC added
 *
 * These will appear as additional questions in the UI via Realtime.
 * User may have already answered some questions - that's fine.
 */
async function generateQuestionsForNewFields(
  documentId: string,
  userId: string,
  newFields: ExtractedField[]
): Promise<number> {
  const supabase = createAdminClient();

  console.log("[AutoForm] QC added new fields, generating questions:", {
    documentId,
    newFieldCount: newFields.length,
    fieldLabels: newFields.map((f) => f.label),
  });

  // Group fields by page
  const fieldsByPage = new Map<number, ExtractedField[]>();
  for (const field of newFields) {
    const pageFields = fieldsByPage.get(field.page_number) || [];
    pageFields.push(field);
    fieldsByPage.set(field.page_number, pageFields);
  }

  let totalQuestions = 0;

  // Generate questions for each page's new fields
  for (const [pageNumber, fields] of fieldsByPage.entries()) {
    try {
      const conversationHistory = await getConversationHistory(documentId);

      // Get context notes from document
      const { data: doc } = await supabase
        .from("documents")
        .select("context_notes")
        .eq("id", documentId)
        .single();

      const result = await generateQuestionsForPage({
        documentId,
        pageNumber,
        pageImageBase64: "", // Not needed (no vision)
        fields,
        conversationHistory,
        contextNotes: doc?.context_notes || undefined,
      });

      // Save new questions (they'll appear via Realtime)
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
          totalQuestions++;
        } catch (error) {
          console.error("[AutoForm] Failed to save reconciliation question:", error);
        }
      }
    } catch (error) {
      console.error("[AutoForm] Failed to generate questions for new fields:", {
        documentId,
        pageNumber,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.log("[AutoForm] Reconciliation questions generated:", {
    documentId,
    totalQuestions,
  });

  return totalQuestions;
}

/**
 * Hide questions for fields that QC removed
 *
 * Why hide instead of delete: Preserves history, can unhide if needed
 */
async function hideQuestionsForFields(
  documentId: string,
  removedFieldIds: string[]
): Promise<number> {
  const supabase = createAdminClient();

  console.log("[AutoForm] QC removed fields, hiding questions:", {
    documentId,
    removedFieldCount: removedFieldIds.length,
  });

  // Find questions that reference removed fields
  const { data: questions } = await supabase
    .from("document_questions")
    .select("*")
    .eq("document_id", documentId)
    .in("status", ["pending", "visible"]);

  let hiddenCount = 0;

  for (const q of questions || []) {
    // If ALL fields for this question were removed, hide it
    const allFieldsRemoved = q.field_ids.every((id: string) =>
      removedFieldIds.includes(id)
    );

    if (allFieldsRemoved) {
      await supabase
        .from("document_questions")
        .update({ status: "hidden" })
        .eq("id", q.id);
      hiddenCount++;
    }
  }

  console.log("[AutoForm] Reconciliation questions hidden:", {
    documentId,
    hiddenCount,
  });

  return hiddenCount;
}
