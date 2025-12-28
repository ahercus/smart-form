import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import {
  getQuestions,
  updateQuestion,
  batchUpdateFieldValues,
} from "@/lib/orchestrator/state";
import { parseAnswerForFields } from "@/lib/gemini/vision";
import { getDocumentFields } from "@/lib/storage";

// GET /api/documents/[id]/questions - Get all questions for a document
export async function GET(
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

    const questions = await getQuestions(id);

    return NextResponse.json({ questions });
  } catch (error) {
    console.error(`[AutoForm] Get questions error:`, error);
    return NextResponse.json(
      { error: "Failed to get questions" },
      { status: 500 }
    );
  }
}

// PATCH /api/documents/[id]/questions - Answer a question
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
    const { questionId, answer, memoryChoice } = body;

    if (!questionId || (answer === undefined && !memoryChoice)) {
      return NextResponse.json(
        { error: "questionId and either answer or memoryChoice are required" },
        { status: 400 }
      );
    }

    // Get the question to find linked field IDs
    const questions = await getQuestions(documentId);
    const question = questions.find((q) => q.id === questionId);

    if (!question) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 }
      );
    }

    // Get field details
    const allFields = await getDocumentFields(documentId);
    const linkedFields = question.field_ids
      .map((fieldId) => allFields.find((f) => f.id === fieldId))
      .filter(Boolean) as typeof allFields;

    let warning: string | undefined;

    // Handle memory_choice: direct field mapping by label, no AI parsing needed
    if (memoryChoice && memoryChoice.values) {
      // Update the question status with the choice label as the answer
      await updateQuestion(questionId, {
        status: "answered",
        answer: memoryChoice.label,
      });

      // Map choice values to field IDs by matching labels
      const fieldUpdates: Array<{ fieldId: string; value: string }> = [];

      for (const [fieldLabel, value] of Object.entries(memoryChoice.values)) {
        // Find the field by label (case-insensitive match)
        const field = linkedFields.find(
          (f) => f.label.toLowerCase() === fieldLabel.toLowerCase()
        );
        if (field) {
          fieldUpdates.push({ fieldId: field.id, value: value as string });
        }
      }

      if (fieldUpdates.length > 0) {
        await batchUpdateFieldValues(fieldUpdates);
      }

      console.log("[AutoForm] Memory choice selected:", {
        documentId,
        questionId,
        choiceLabel: memoryChoice.label,
        fieldsUpdated: fieldUpdates.length,
      });

      return NextResponse.json({ success: true });
    }

    // Standard answer flow: Update the question status and answer
    await updateQuestion(questionId, {
      status: "answered",
      answer,
    });

    // Parse the answer and distribute to correct fields using Gemini
    if (linkedFields.length > 0) {
      const fieldsForParsing = linkedFields.map((f) => ({
        id: f.id,
        label: f.label,
        fieldType: f.field_type,
      }));

      const parseResult = await parseAnswerForFields({
        question: question.question,
        answer,
        fields: fieldsForParsing,
      });

      // Only write values if AI is confident in the parsing
      if (parseResult.confident) {
        await batchUpdateFieldValues(
          parseResult.parsedValues.map(({ fieldId, value }) => ({
            fieldId,
            value,
          }))
        );

        console.log("[AutoForm] Question answered with parsed values:", {
          documentId,
          questionId,
          answer: answer.slice(0, 50),
          linkedFields: linkedFields.length,
          parsedFields: parseResult.parsedValues.length,
        });
      } else {
        // Not confident - don't write anything, return warning
        warning = parseResult.warning;
        console.log("[AutoForm] Answer parsing not confident, fields not updated:", {
          documentId,
          questionId,
          warning,
        });
      }
    } else {
      console.log("[AutoForm] Question answered (no linked fields):", {
        documentId,
        questionId,
        answer: answer.slice(0, 50),
      });
    }

    // Scoped write: Only the linked fields are populated
    // No cross-question auto-fill - that's handled during initial context gathering
    return NextResponse.json({ success: true, warning });
  } catch (error) {
    console.error(`[AutoForm] Answer question error:`, error);
    return NextResponse.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}
