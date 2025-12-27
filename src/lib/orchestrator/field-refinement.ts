// Field refinement - runs Gemini QC on fields WITHOUT generating questions
// This runs immediately after Azure DI, before user submits context

import { reviewFieldsWithVision } from "../gemini/vision";
import { createAdminClient } from "../supabase/admin";
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
      const reviewResult = await reviewFieldsWithVision({
        documentId,
        pageNumber,
        pageImageBase64: imageBase64,
        fields: pageFields as ExtractedField[],
      });

      // Apply adjustments
      const { adjustments, newFields, removeFields } = reviewResult;

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

          await supabase
            .from("extracted_fields")
            .update(updateData)
            .eq("id", adj.fieldId);

          totalAdjusted++;
        }
      }

      // Add new fields
      for (const newField of newFields) {
        const { error: insertError } = await supabase
          .from("extracted_fields")
          .insert({
            document_id: documentId,
            page_number: pageNumber,
            field_index: pageFields.length + newFields.indexOf(newField),
            label: newField.label,
            field_type: newField.fieldType,
            coordinates: newField.coordinates,
            detection_source: "gemini_vision",
          });

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

      console.log(`[AutoForm] Page ${pageNumber} refinement complete:`, {
        adjusted: adjustments.length,
        added: newFields.length,
        removed: removeFields.length,
      });
    }

    // Mark fields as QC complete
    await supabase
      .from("documents")
      .update({
        fields_qc_complete: true,
        status: "extracting", // Ready for context, not fully ready yet
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] ==========================================");
    console.log("[AutoForm] Field refinement complete:", {
      documentId,
      totalAdjusted,
      totalAdded,
      totalRemoved,
    });
    console.log("[AutoForm] ==========================================");

    return {
      success: true,
      fieldsAdjusted: totalAdjusted,
      fieldsAdded: totalAdded,
      fieldsRemoved: totalRemoved,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AutoForm] Field refinement failed (graceful degradation):", {
      documentId,
      error: errorMessage,
    });

    // GRACEFUL DEGRADATION: Mark QC as complete anyway
    // Azure DI fields are still usable even without Gemini refinement
    await supabase
      .from("documents")
      .update({
        fields_qc_complete: true,
        status: "extracting", // Ready for context
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    console.log("[AutoForm] Field QC marked complete despite refinement failure:", {
      documentId,
      reason: "Azure DI fields are still usable",
    });

    return {
      success: true, // Partial success - fields exist, just not refined
      fieldsAdjusted: 0,
      fieldsAdded: 0,
      fieldsRemoved: 0,
      error: errorMessage,
    };
  }
}
