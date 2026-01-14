// Field refinement - runs Gemini QC on fields WITHOUT generating questions
// This runs immediately after Azure DI, before user submits context
//
// QC RECONCILIATION:
// After QC completes, if questions were already generated (optimistic rendering),
// we need to reconcile:
// - If QC added fields -> generate questions for them
// - If QC removed fields -> hide their questions
// - If QC adjusted fields -> no action needed (questions still valid)
//
// SMART QUADRANT SPLITTING:
// To improve QC speed and accuracy, we split each page into quadrants:
// 1. Analyze field positions from Azure to find natural gaps
// 2. Split page at gaps (avoiding cutting through fields)
// 3. Process each quadrant with a separate QC call (in parallel)
// This allows Flash model to focus on smaller regions with better accuracy.

import { reviewFieldsWithVision, reviewQuadrantWithVision, discoverMissedFields, generateQuestionsForPage, type FieldReviewResult } from "../gemini/vision";
import { compositeFieldsOntoImage } from "../image-compositor";
import { createAdminClient } from "../supabase/admin";
import { getConversationHistory, saveQuestion } from "./state";
import { checkAndFinalizeIfReady } from "./question-finalization";
import type { ExtractedField, FieldType, NormalizedCoordinates, ChoiceOption } from "../types";

/**
 * Represents a cluster of nearby fields for focused QC
 */
interface FieldCluster {
  /** Bounding box as percentage of page (0-100), with padding */
  bounds: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  /** Fields in this cluster */
  fields: ExtractedField[];
  /** Cluster index */
  index: number;
}

/**
 * Calculate distance between two fields (center-to-center)
 */
function fieldDistance(a: ExtractedField, b: ExtractedField): number {
  const aCenterX = a.coordinates.left + a.coordinates.width / 2;
  const aCenterY = a.coordinates.top + a.coordinates.height / 2;
  const bCenterX = b.coordinates.left + b.coordinates.width / 2;
  const bCenterY = b.coordinates.top + b.coordinates.height / 2;

  return Math.sqrt(
    Math.pow(aCenterX - bCenterX, 2) + Math.pow(aCenterY - bCenterY, 2)
  );
}

/**
 * Cluster fields by proximity using a simple greedy algorithm
 * Fields within `proximityThreshold` of any field in a cluster join that cluster
 */
function clusterFieldsByProximity(
  fields: ExtractedField[],
  proximityThreshold: number = 15 // percentage of page
): ExtractedField[][] {
  if (fields.length === 0) return [];
  if (fields.length === 1) return [[fields[0]]];

  const clusters: ExtractedField[][] = [];
  const assigned = new Set<string>();

  // Sort fields by position (top-left to bottom-right) for consistent clustering
  const sortedFields = [...fields].sort((a, b) => {
    const aPos = a.coordinates.top * 100 + a.coordinates.left;
    const bPos = b.coordinates.top * 100 + b.coordinates.left;
    return aPos - bPos;
  });

  for (const field of sortedFields) {
    if (assigned.has(field.id)) continue;

    // Start a new cluster with this field
    const cluster: ExtractedField[] = [field];
    assigned.add(field.id);

    // Find all fields close to any field in this cluster
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of sortedFields) {
        if (assigned.has(candidate.id)) continue;

        // Check if candidate is close to any field in the cluster
        for (const clusterField of cluster) {
          if (fieldDistance(candidate, clusterField) <= proximityThreshold) {
            cluster.push(candidate);
            assigned.add(candidate.id);
            expanded = true;
            break;
          }
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Calculate tight bounding box around a cluster of fields with padding
 */
function getClusterBounds(
  fields: ExtractedField[],
  padding: number = 8 // percentage padding around cluster
): FieldCluster["bounds"] {
  if (fields.length === 0) {
    return { top: 0, left: 0, bottom: 100, right: 100 };
  }

  let minTop = 100, minLeft = 100, maxBottom = 0, maxRight = 0;

  for (const field of fields) {
    const top = field.coordinates.top;
    const left = field.coordinates.left;
    const bottom = top + field.coordinates.height;
    const right = left + field.coordinates.width;

    minTop = Math.min(minTop, top);
    minLeft = Math.min(minLeft, left);
    maxBottom = Math.max(maxBottom, bottom);
    maxRight = Math.max(maxRight, right);
  }

  // Add padding, clamped to page bounds
  return {
    top: Math.max(0, minTop - padding),
    left: Math.max(0, minLeft - padding),
    bottom: Math.min(100, maxBottom + padding),
    right: Math.min(100, maxRight + padding),
  };
}

/**
 * Cluster fields on a page for focused QC
 * Returns clusters with tight bounding boxes for precision coordinate adjustment
 */
export function clusterPageFields(
  fields: ExtractedField[],
  pageNumber: number
): FieldCluster[] {
  const pageFields = fields.filter((f) => f.page_number === pageNumber);

  if (pageFields.length === 0) {
    return [];
  }

  // Cluster fields by proximity
  const fieldGroups = clusterFieldsByProximity(pageFields, 15);

  // Create cluster objects with bounds
  const clusters: FieldCluster[] = fieldGroups.map((group, index) => ({
    bounds: getClusterBounds(group, 8),
    fields: group,
    index,
  }));

  console.log(`[AutoForm] Page ${pageNumber} clustered into ${clusters.length} groups:`, {
    fieldCount: pageFields.length,
    clusterDetails: clusters.map((c) => ({
      index: c.index,
      fields: c.fields.length,
      bounds: `${c.bounds.top.toFixed(0)}-${c.bounds.bottom.toFixed(0)}%, ${c.bounds.left.toFixed(0)}-${c.bounds.right.toFixed(0)}%`,
    })),
  });

  return clusters;
}

/**
 * Merge results from multiple cluster QC calls into a single page result
 */
function mergeClusterResults(
  clusterResults: FieldReviewResult[]
): FieldReviewResult {
  const adjustments: FieldReviewResult["adjustments"] = [];
  const newFields: FieldReviewResult["newFields"] = [];
  const removeFields: string[] = [];
  let allValidated = true;

  for (const result of clusterResults) {
    adjustments.push(...result.adjustments);
    newFields.push(...result.newFields);
    removeFields.push(...result.removeFields);
    if (!result.fieldsValidated) {
      allValidated = false;
    }
  }

  // Deduplicate removeFields (same field might be flagged in overlapping regions)
  const uniqueRemoveFields = [...new Set(removeFields)];

  return {
    adjustments,
    newFields,
    removeFields: uniqueRemoveFields,
    fieldsValidated: allValidated,
  };
}

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

    // Process all pages in PARALLEL for maximum speed
    console.log(`[AutoForm] ⏱️ QC PARALLEL START - Processing ${pageImages.length} pages:`, {
      documentId,
      pageNumbers: pageImages.map(p => p.pageNumber),
    });

    const qcParallelStart = Date.now();

    // Define the type for QC results
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

    // Run Gemini Vision QC on ALL pages in parallel
    // IMPORTANT: Even pages with 0 Azure fields should be analyzed by Vision
    // Vision can detect fields that Azure missed (e.g., scanned forms, unusual layouts)
    //
    // DUAL-TRACK QC:
    // 1. CLUSTER TRACK: Tight crops around field clusters for precision coordinate adjustment
    // 2. DISCOVERY TRACK: Full page scan to find fields Azure missed
    // Both tracks run in parallel for maximum speed.
    const pageQCPromises = pageImages.map(async (pageImage): Promise<PageQCResult> => {
      const { pageNumber, imageBase64 } = pageImage;
      const pageFields = (allFields?.filter((f) => f.page_number === pageNumber) || []) as ExtractedField[];

      const qcStartTime = Date.now();

      // If no Azure fields, just do full-page discovery
      if (pageFields.length === 0) {
        console.log(`[AutoForm] Page ${pageNumber}: No Azure fields, running discovery only`, {
          documentId,
        });

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

      // Cluster fields for precision QC
      const clusters = clusterPageFields(allFields as ExtractedField[] || [], pageNumber);

      console.log(`[AutoForm] Page ${pageNumber}: Running dual-track QC`, {
        documentId,
        azureFieldCount: pageFields.length,
        clusterCount: clusters.length,
      });

      // Create composite image with field overlays for discovery track
      const compositedForDiscovery = await compositeFieldsOntoImage({
        imageBase64,
        fields: pageFields,
        showGrid: true,
        gridSpacing: 10,
      });

      // PARALLEL: Run all cluster QC + discovery scan together
      const clusterPromises = clusters.map(async (cluster) => {
        return reviewQuadrantWithVision({
          documentId,
          pageNumber,
          pageImageBase64: imageBase64,
          fields: cluster.fields,
          quadrantBounds: cluster.bounds,
          quadrantIndex: cluster.index,
        });
      });

      const discoveryPromise = discoverMissedFields({
        documentId,
        pageNumber,
        pageImageBase64: compositedForDiscovery.imageBase64,
        existingFieldIds: pageFields.map((f) => f.id),
      });

      // Wait for all to complete
      const [clusterResults, discoveryResult] = await Promise.all([
        Promise.all(clusterPromises),
        discoveryPromise,
      ]);

      const qcDuration = Date.now() - qcStartTime;

      // Merge cluster results (adjustments + removals)
      const clusterMerged = mergeClusterResults(clusterResults);

      // Combine with discovery results (new fields only)
      const finalResult: FieldReviewResult = {
        adjustments: clusterMerged.adjustments,
        newFields: [...clusterMerged.newFields, ...discoveryResult.newFields],
        removeFields: clusterMerged.removeFields,
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

    // Wait for all pages to complete QC
    const pageQCResults = await Promise.all(pageQCPromises);

    const qcParallelDuration = Date.now() - qcParallelStart;
    const longestPageQC = Math.max(...pageQCResults.map(r => r.duration));

    console.log(`[AutoForm] ⏱️ QC PARALLEL COMPLETE (${(qcParallelDuration / 1000).toFixed(1)}s wall clock):`, {
      documentId,
      longestPage: `${(longestPageQC / 1000).toFixed(1)}s`,
      perPage: pageQCResults.map(r => ({
        page: r.pageNumber,
        duration: `${(r.duration / 1000).toFixed(1)}s`,
        skipped: r.skipped,
      })),
    });

    // Now apply all results to the database
    for (const result of pageQCResults) {
      if (result.skipped) continue;

      const { pageNumber, pageFields, adjustments, newFields, removeFields, duration } = result;

      // Log QC summary with timing
      console.log(`[AutoForm] QC Results for page ${pageNumber}:`, {
        documentId,
        duration: `${(duration / 1000).toFixed(1)}s`,
        fieldsReviewed: pageFields?.length || 0,
        adjustments: adjustments.length,
        newFields: newFields.length,
        removals: removeFields.length,
      });

      // Log detailed adjustments for debugging
      if (adjustments.length > 0 && pageFields) {
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
      if (removeFields.length > 0 && pageFields) {
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
          field_index: (pageFields?.length || 0) + newFields.indexOf(newField),
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

    // PRE-WARM FINALIZATION: Check if we can finalize pre-generated questions
    // This happens when:
    // 1. Context was already submitted (user was waiting)
    // 2. Questions were pre-generated (not old document)
    //
    // The finalization will:
    // - Filter out questions for QC-deleted fields
    // - Generate questions for QC-discovered fields
    // - Apply context to auto-answer questions
    // - Make remaining questions visible
    let questionsGenerated = 0;
    let questionsHidden = 0;

    const finalized = await checkAndFinalizeIfReady(documentId, userId);

    if (finalized) {
      console.log("[AutoForm] Questions finalized after QC:", { documentId });
    } else {
      // Check why we didn't finalize
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
