import { reviewQuadrantWithVision, discoverMissedFields, generateQuestionsForPage, type FieldReviewResult } from "../../gemini/vision";
import { compositeFieldsOntoImage } from "../../image-compositor";
import { createAdminClient } from "../../supabase/admin";
import { getConversationHistory, saveQuestion } from "../state";
import { checkAndFinalizeIfReady } from "../question-finalization";
import type { ExtractedField, FieldType, NormalizedCoordinates, ChoiceOption } from "../../types";
import { clusterPageFields } from "./clustering";
import { convertDiscoveryCoordinates, mergeClusterResults } from "./merge";
import { applyAdjustments, insertNewFields, softDeleteFields, type FieldAdjustment } from "./db";

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
  const totalStartTime = Date.now();

  console.log("[AutoForm] ==========================================");
  console.log("[AutoForm] ⏱️ FIELD REFINEMENT (QC) START:", {
    documentId,
    pageCount: pageImages.length,
  });
  console.log("[AutoForm] ==========================================");

  try {
    await supabase.from("documents").update({ status: "refining" }).eq("id", documentId);

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

    console.log(`[AutoForm] ⏱️ QC PARALLEL START - Processing ${pageImages.length} pages:`, {
      documentId,
      pageNumbers: pageImages.map((p) => p.pageNumber),
    });

    const qcParallelStart = Date.now();

    interface PageQCResult {
      pageNumber: number;
      skipped: boolean;
      pageFields: ExtractedField[];
      adjustments: Array<{
        fieldId: string;
        action: "update";
        changes: Partial<{
          label: string;
          fieldType: FieldType;
          coordinates: NormalizedCoordinates;
          choiceOptions: ChoiceOption[];
        }>;
      }>;
      newFields: Array<{
        label: string;
        fieldType: FieldType;
        coordinates: NormalizedCoordinates;
        choiceOptions?: ChoiceOption[];
      }>;
      removeFields: string[];
      fieldsValidated: boolean;
      duration: number;
    }

    const pageQCPromises = pageImages.map(async (pageImage): Promise<PageQCResult> => {
      const { pageNumber, imageBase64 } = pageImage;
      const pageFields = (allFields?.filter((f) => f.page_number === pageNumber) || []) as ExtractedField[];

      const qcStartTime = Date.now();

      if (pageFields.length === 0) {
        console.log(`[AutoForm] Page ${pageNumber}: No Azure fields, running discovery only`, { documentId });

        const discoveryResult = await discoverMissedFields({
          documentId,
          pageNumber,
          pageImageBase64: imageBase64,
          existingFieldIds: [],
        });

        const qcDuration = Date.now() - qcStartTime;

        return {
          pageNumber,
          skipped: false,
          pageFields,
          ...discoveryResult,
          duration: qcDuration,
        };
      }

      const clusters = clusterPageFields(allFields as ExtractedField[] || [], pageNumber);

      console.log(`[AutoForm] Page ${pageNumber}: Running dual-track QC`, {
        documentId,
        azureFieldCount: pageFields.length,
        clusterCount: clusters.length,
      });

      const compositedForDiscovery = await compositeFieldsOntoImage({
        imageBase64,
        fields: pageFields,
        showGrid: true,
        gridSpacing: 10,
      });

      const clusterPromises = clusters.map(async (cluster) =>
        reviewQuadrantWithVision({
          documentId,
          pageNumber,
          pageImageBase64: imageBase64,
          fields: cluster.fields,
          quadrantBounds: cluster.bounds,
          quadrantIndex: cluster.index,
        })
      );

      const discoveryPromise = discoverMissedFields({
        documentId,
        pageNumber,
        pageImageBase64: compositedForDiscovery.imageBase64,
        existingFieldIds: pageFields.map((f) => f.id),
        existingFields: pageFields.map((f) => ({
          id: f.id,
          label: f.label,
          fieldType: f.field_type,
        })),
      });

      const [clusterResults, discoveryResultRaw] = await Promise.all([
        Promise.all(clusterPromises),
        discoveryPromise,
      ]);

      const qcDuration = Date.now() - qcStartTime;

      const discoveryResult = convertDiscoveryCoordinates(
        discoveryResultRaw,
        compositedForDiscovery.width,
        compositedForDiscovery.height
      );

      const clusterMerged = mergeClusterResults(clusterResults);

      const globalRemovals = new Set(discoveryResult.removeFields || []);
      const finalAdjustments = clusterMerged.adjustments.filter((adj) => !globalRemovals.has(adj.fieldId));
      const finalRemovals = [...new Set([...clusterMerged.removeFields, ...globalRemovals])];

      const finalResult: FieldReviewResult = {
        adjustments: finalAdjustments,
        newFields: [...clusterMerged.newFields, ...discoveryResult.newFields],
        removeFields: finalRemovals,
        fieldsValidated: clusterMerged.fieldsValidated && discoveryResult.fieldsValidated,
      };

      console.log(`[AutoForm] Page ${pageNumber} dual-track QC complete:`, {
        clusterCount: clusters.length,
        adjustments: finalResult.adjustments.length,
        newFieldsFromClusters: clusterMerged.newFields.length,
        newFieldsFromDiscovery: discoveryResult.newFields.length,
        removals: finalResult.removeFields.length,
        duration: `${(qcDuration / 1000).toFixed(1)}s`,
      });

      return {
        pageNumber,
        skipped: false,
        pageFields,
        ...finalResult,
        duration: qcDuration,
      };
    });

    const pageQCResults = await Promise.all(pageQCPromises);

    const qcParallelDuration = Date.now() - qcParallelStart;
    const longestPageQC = Math.max(...pageQCResults.map((r) => r.duration));

    console.log(`[AutoForm] ⏱️ QC PARALLEL COMPLETE (${(qcParallelDuration / 1000).toFixed(1)}s wall clock):`, {
      documentId,
      longestPage: `${(longestPageQC / 1000).toFixed(1)}s`,
      perPage: pageQCResults.map((r) => ({
        page: r.pageNumber,
        duration: `${(r.duration / 1000).toFixed(1)}s`,
        skipped: r.skipped,
      })),
    });

    const allAdjustments: FieldAdjustment[] = [];
    const allNewFields: Array<Record<string, unknown>> = [];
    const allRemoveFieldIds: string[] = [];

    const dbBatchStart = Date.now();

    for (const result of pageQCResults) {
      if (result.skipped) continue;

      const { pageNumber, pageFields, adjustments, newFields, removeFields, duration } = result;

      console.log(`[AutoForm] QC Results for page ${pageNumber}:`, {
        documentId,
        duration: `${(duration / 1000).toFixed(1)}s`,
        fieldsReviewed: pageFields?.length || 0,
        adjustments: adjustments.length,
        newFields: newFields.length,
        removals: removeFields.length,
      });

      if (adjustments.length > 0 && pageFields) {
        const adjustmentDetails = adjustments
          .map((adj) => {
            const originalField = pageFields.find((f) => f.id === adj.fieldId);
            const orig = originalField?.coordinates;
            const newC = adj.changes?.coordinates;

            let coordChange = null;
            if (newC && orig) {
              const topDelta = (newC.top - orig.top).toFixed(1);
              const leftDelta = (newC.left - orig.left).toFixed(1);
              const heightDelta = (newC.height - orig.height).toFixed(1);
              coordChange =
                `top: ${orig.top.toFixed(1)}→${newC.top.toFixed(1)} (${topDelta}), ` +
                `left: ${orig.left.toFixed(1)}→${newC.left.toFixed(1)} (${leftDelta}), ` +
                `height: ${orig.height.toFixed(1)}→${newC.height.toFixed(1)} (${heightDelta})`;
            }

            return {
              field: originalField?.label || adj.fieldId.slice(0, 8),
              label: adj.changes?.label ? `→ "${adj.changes.label}"` : null,
              type: adj.changes?.fieldType ? `→ ${adj.changes.fieldType}` : null,
              coords: coordChange,
            };
          })
          .filter((a) => a.label || a.type || a.coords);

        console.log(`[AutoForm] QC Adjustments (page ${pageNumber}):`);
        adjustmentDetails.forEach((a) => {
          console.log(`  - ${a.field}:`, a.coords || a.label || a.type);
        });
      }

      if (newFields.length > 0) {
        console.log(
          `[AutoForm] QC New Fields (page ${pageNumber}):`,
          newFields.map((f) => ({
            label: f.label,
            type: f.fieldType,
            coords: `(${f.coordinates.left.toFixed(1)}%, ${f.coordinates.top.toFixed(1)}%)`,
          }))
        );
      }

      if (removeFields.length > 0 && pageFields) {
        console.log(
          `[AutoForm] QC Removed Fields (page ${pageNumber}):`,
          removeFields.map((id) => {
            const field = pageFields.find((f) => f.id === id);
            return { id: id.slice(0, 8) + "...", label: field?.label };
          })
        );
      }

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

          allAdjustments.push({ fieldId: adj.fieldId, updateData });
        }
      }

      for (const newField of newFields) {
        const insertData: Record<string, unknown> = {
          document_id: documentId,
          page_number: pageNumber,
          field_index: (pageFields?.length || 0) + newFields.indexOf(newField),
          label: newField.label,
          field_type: newField.fieldType,
          coordinates: newField.coordinates,
          detection_source: "gemini_vision",
        };

        if (newField.choiceOptions) {
          insertData.choice_options = newField.choiceOptions;
        }

        allNewFields.push(insertData);
      }

      allRemoveFieldIds.push(...removeFields);
    }

    const dbOps: Promise<void>[] = [];

    if (allAdjustments.length > 0) {
      dbOps.push(
        applyAdjustments(supabase, allAdjustments).then((count) => {
          totalAdjusted = count;
        })
      );
    }

    if (allNewFields.length > 0) {
      dbOps.push(
        insertNewFields(supabase, allNewFields).then((count) => {
          totalAdded = count;
        })
      );
    }

    if (allRemoveFieldIds.length > 0) {
      dbOps.push(
        softDeleteFields(supabase, allRemoveFieldIds).then((count) => {
          totalRemoved = count;
        })
      );
    }

    await Promise.all(dbOps);

    const dbBatchDuration = Date.now() - dbBatchStart;
    console.log(`[AutoForm] ⏱️ DB batch write complete (${dbBatchDuration}ms):`, {
      adjustments: allAdjustments.length,
      inserts: allNewFields.length,
      deletes: allRemoveFieldIds.length,
    });

    await supabase
      .from("documents")
      .update({
        fields_qc_complete: true,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Document marked ready after QC:", { documentId });

    let questionsGenerated = 0;
    let questionsHidden = 0;

    const finalized = await checkAndFinalizeIfReady(documentId, userId);

    if (finalized) {
      console.log("[AutoForm] Questions finalized after QC:", { documentId });
    } else {
      const { data: doc } = await supabase
        .from("documents")
        .select("context_submitted, questions_pregenerated, questions_generated_at")
        .eq("id", documentId)
        .single();

      console.log("[AutoForm] Finalization not triggered:", {
        documentId,
        context_submitted: doc?.context_submitted,
        questions_pregenerated: doc?.questions_pregenerated,
        questions_generated_at: doc?.questions_generated_at,
        reason: !doc?.context_submitted
          ? "Waiting for user to submit context"
          : !doc?.questions_pregenerated
          ? "Pre-generation not complete"
          : "Questions already generated",
      });
    }

    const totalDuration = Date.now() - totalStartTime;
    console.log("[AutoForm] ==========================================");
    console.log(`[AutoForm] ⏱️ FIELD REFINEMENT (QC) COMPLETE (${(totalDuration / 1000).toFixed(1)}s):`, {
      documentId,
      totalAdjusted,
      totalAdded,
      totalRemoved,
      questionsGenerated,
      questionsHidden,
      durationMs: totalDuration,
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
      success: true,
      fieldsAdjusted: 0,
      fieldsAdded: 0,
      fieldsRemoved: 0,
      questionsGenerated: 0,
      questionsHidden: 0,
      error: errorMessage,
    };
  }
}

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

  const fieldsByPage = new Map<number, ExtractedField[]>();
  for (const field of newFields) {
    const pageFields = fieldsByPage.get(field.page_number) || [];
    pageFields.push(field);
    fieldsByPage.set(field.page_number, pageFields);
  }

  let totalQuestions = 0;

  for (const [pageNumber, fields] of fieldsByPage.entries()) {
    try {
      const conversationHistory = await getConversationHistory(documentId);

      const { data: doc } = await supabase
        .from("documents")
        .select("context_notes")
        .eq("id", documentId)
        .single();

      const result = await generateQuestionsForPage({
        documentId,
        pageNumber,
        pageImageBase64: "",
        fields,
        conversationHistory,
        contextNotes: doc?.context_notes || undefined,
      });

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
        } catch (err) {
          console.error("[AutoForm] Failed to save reconciliation question:", err);
        }
      }
    } catch (err) {
      console.error("[AutoForm] Failed to generate questions for new fields:", {
        documentId,
        pageNumber,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  console.log("[AutoForm] Reconciliation questions generated:", {
    documentId,
    totalQuestions,
  });

  return totalQuestions;
}

async function hideQuestionsForFields(
  documentId: string,
  removedFieldIds: string[]
): Promise<number> {
  const supabase = createAdminClient();

  console.log("[AutoForm] QC removed fields, hiding questions:", {
    documentId,
    removedFieldCount: removedFieldIds.length,
  });

  const { data: questions } = await supabase
    .from("document_questions")
    .select("*")
    .eq("document_id", documentId)
    .in("status", ["pending", "visible"]);

  let hiddenCount = 0;

  for (const q of questions || []) {
    const allFieldsRemoved = q.field_ids.every((id: string) => removedFieldIds.includes(id));

    if (allFieldsRemoved) {
      await supabase.from("document_questions").update({ status: "hidden" }).eq("id", q.id);
      hiddenCount++;
    }
  }

  console.log("[AutoForm] Reconciliation questions hidden:", {
    documentId,
    hiddenCount,
  });

  return hiddenCount;
}

export { clusterPageFields } from "./clustering";
