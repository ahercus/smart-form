import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import {
  getQuestions,
  updateQuestion,
  batchUpdateFieldValues,
} from "@/lib/orchestrator/state";
import { reevaluatePendingQuestions, parseAnswerForFields } from "@/lib/gemini/vision";
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
    const { questionId, answer } = body;

    if (!questionId || answer === undefined) {
      return NextResponse.json(
        { error: "questionId and answer are required" },
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

    // Update the question status and answer
    await updateQuestion(questionId, {
      status: "answered",
      answer,
    });

    // Get field details for parsing
    const allFields = await getDocumentFields(documentId);
    const linkedFields = question.field_ids
      .map((fieldId) => allFields.find((f) => f.id === fieldId))
      .filter(Boolean) as typeof allFields;

    // Parse the answer and distribute to correct fields using Gemini
    if (linkedFields.length > 0) {
      const fieldsForParsing = linkedFields.map((f) => ({
        id: f.id,
        label: f.label,
        fieldType: f.field_type,
      }));

      const parsedValues = await parseAnswerForFields({
        question: question.question,
        answer,
        fields: fieldsForParsing,
      });

      // Apply parsed values to each field
      await batchUpdateFieldValues(
        parsedValues.map(({ fieldId, value }) => ({
          fieldId,
          value,
        }))
      );

      console.log("[AutoForm] Question answered with parsed values:", {
        documentId,
        questionId,
        answer: answer.slice(0, 50),
        linkedFields: linkedFields.length,
        parsedFields: parsedValues.length,
      });
    } else {
      console.log("[AutoForm] Question answered (no fields):", {
        documentId,
        questionId,
        answer: answer.slice(0, 50),
      });
    }

    // Re-evaluate pending questions to see if this answer can auto-fill others
    const pendingQuestions = questions.filter(
      (q) => q.status === "visible" && q.id !== questionId
    );

    if (pendingQuestions.length > 0) {
      const fields = await getDocumentFields(documentId);
      const autoAnswers = await reevaluatePendingQuestions({
        newAnswer: { question: question.question, answer },
        pendingQuestions: pendingQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          fieldIds: q.field_ids,
        })),
        fields,
      });

      // Apply auto-answers
      for (const autoAnswer of autoAnswers) {
        const targetQuestion = pendingQuestions.find(
          (q) => q.id === autoAnswer.questionId
        );
        if (targetQuestion) {
          await updateQuestion(autoAnswer.questionId, {
            status: "answered",
            answer: autoAnswer.answer,
          });

          if (targetQuestion.field_ids.length > 0) {
            await batchUpdateFieldValues(
              targetQuestion.field_ids.map((fieldId) => ({
                fieldId,
                value: autoAnswer.answer,
              }))
            );
          }

          console.log("[AutoForm] Question auto-answered:", {
            documentId,
            questionId: autoAnswer.questionId,
            reasoning: autoAnswer.reasoning,
          });
        }
      }

      return NextResponse.json({
        success: true,
        autoAnswered: autoAnswers.length,
      });
    }

    return NextResponse.json({ success: true, autoAnswered: 0 });
  } catch (error) {
    console.error(`[AutoForm] Answer question error:`, error);
    return NextResponse.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}
