import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, updateField, getField, createField } from "@/lib/storage";
import type { FieldUpdate, NormalizedCoordinates } from "@/lib/types";

// PATCH /api/documents/[id]/fields - Update field values or coordinates
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const document = await getDocument(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();

    // Handle single field coordinates update
    if (body.fieldId && body.coordinates) {
      const coords = body.coordinates as NormalizedCoordinates;
      const field = await updateField(body.fieldId, {
        coordinates: coords,
        manually_adjusted: true,
      });

      console.log("[AutoForm] Field coordinates updated:", {
        fieldId: body.fieldId,
        coordinates: coords,
      });

      return NextResponse.json({ success: true, field });
    }

    // Handle batch value updates
    const updates: FieldUpdate[] = body.updates;

    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: "updates must be an array or provide fieldId+coordinates" },
        { status: 400 }
      );
    }

    // Update each field
    const results = await Promise.all(
      updates.map(async (update) => {
        try {
          const field = await updateField(update.field_id, {
            value: update.value,
            manually_adjusted: true,
          });
          return { field_id: update.field_id, success: true, field };
        } catch (error) {
          return {
            field_id: update.field_id,
            success: false,
            error: error instanceof Error ? error.message : "Update failed",
          };
        }
      })
    );

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      return NextResponse.json(
        {
          success: false,
          updated: results.filter((r) => r.success).length,
          failed: failures.length,
          errors: failures,
        },
        { status: 207 }
      );
    }

    return NextResponse.json({
      success: true,
      updated: results.length,
    });
  } catch (error) {
    console.error(`[AutoForm] Update fields error:`, error);
    return NextResponse.json(
      { error: "Failed to update fields" },
      { status: 500 }
    );
  }
}

// POST /api/documents/[id]/fields - Create or copy a field
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  try {
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { sourceFieldId, pageNumber, coordinates, fieldType, value } = body;

    // Create a new field from scratch
    if (pageNumber && coordinates) {
      // Determine label based on field type
      const type = fieldType || "text";
      const label = type === "signature" ? "Signature" : type === "initials" ? "Initials" : "New Field";

      const newField = await createField({
        document_id: documentId,
        page_number: pageNumber,
        label,
        field_type: type,
        coordinates: coordinates as NormalizedCoordinates,
        value: value || null,
        ai_suggested_value: null,
        ai_confidence: null,
        help_text: null,
        detection_source: "manual",
        confidence_score: null,
        manually_adjusted: true,
        choice_options: null,
      });

      console.log("[AutoForm] Field created:", {
        fieldId: newField.id,
        pageNumber,
        fieldType: type,
        hasValue: !!value,
      });

      return NextResponse.json({ success: true, field: newField });
    }

    // Copy an existing field
    if (!sourceFieldId) {
      return NextResponse.json(
        { error: "sourceFieldId or (pageNumber + coordinates) required" },
        { status: 400 }
      );
    }

    const sourceField = await getField(sourceFieldId);
    if (!sourceField || sourceField.document_id !== documentId) {
      return NextResponse.json(
        { error: "Source field not found" },
        { status: 404 }
      );
    }

    // Create a copy with offset coordinates
    const offset = 2; // 2% offset
    const newCoords: NormalizedCoordinates = {
      left: Math.min(sourceField.coordinates.left + offset, 100 - sourceField.coordinates.width),
      top: Math.min(sourceField.coordinates.top + offset, 100 - sourceField.coordinates.height),
      width: sourceField.coordinates.width,
      height: sourceField.coordinates.height,
    };

    const newField = await createField({
      document_id: documentId,
      page_number: sourceField.page_number,
      label: `${sourceField.label} (copy)`,
      field_type: sourceField.field_type,
      coordinates: newCoords,
      value: null,
      ai_suggested_value: null,
      ai_confidence: null,
      help_text: sourceField.help_text,
      detection_source: "manual",
      confidence_score: null,
      manually_adjusted: true,
      choice_options: sourceField.choice_options,
    });

    console.log("[AutoForm] Field copied:", {
      sourceFieldId,
      newFieldId: newField.id,
    });

    return NextResponse.json({ success: true, field: newField });
  } catch (error) {
    console.error(`[AutoForm] Create/copy field error:`, error);
    return NextResponse.json(
      { error: "Failed to create/copy field" },
      { status: 500 }
    );
  }
}

// DELETE /api/documents/[id]/fields - Delete a field (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  try {
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const fieldId = searchParams.get("fieldId");

    if (!fieldId) {
      return NextResponse.json(
        { error: "fieldId query param is required" },
        { status: 400 }
      );
    }

    // Verify field belongs to this document
    const field = await getField(fieldId);
    if (!field || field.document_id !== documentId) {
      return NextResponse.json(
        { error: "Field not found" },
        { status: 404 }
      );
    }

    // Soft delete by setting deleted_at
    await updateField(fieldId, {
      deleted_at: new Date().toISOString(),
    });

    // Check for questions that only had this field - delete them
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const adminClient = createAdminClient();

    const { data: affectedQuestions } = await adminClient
      .from("document_questions")
      .select("id, field_ids")
      .eq("document_id", documentId)
      .contains("field_ids", [fieldId]);

    let questionsDeleted = 0;
    for (const q of affectedQuestions || []) {
      const fieldIds = q.field_ids as string[];
      // If this was the only field in the question, delete it
      if (fieldIds.length === 1 && fieldIds[0] === fieldId) {
        await adminClient
          .from("document_questions")
          .delete()
          .eq("id", q.id);
        questionsDeleted++;
      }
    }

    console.log("[AutoForm] Field deleted:", { fieldId, documentId, questionsDeleted });

    return NextResponse.json({ success: true, questionsDeleted });
  } catch (error) {
    console.error(`[AutoForm] Delete field error:`, error);
    return NextResponse.json(
      { error: "Failed to delete field" },
      { status: 500 }
    );
  }
}
