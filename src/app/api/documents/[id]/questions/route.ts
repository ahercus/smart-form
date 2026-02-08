import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import {
  getQuestions,
  updateQuestion,
  batchUpdateFieldValues,
} from "@/lib/orchestrator/state";
import { parseAnswerForFields, reevaluatePendingQuestions } from "@/lib/gemini/vision";
import { getDocumentFields } from "@/lib/storage";
import type { ExtractedField, QuestionGroup } from "@/lib/types";

// Base URL for internal API calls
const getBaseUrl = () => {
  // In production, use the deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // In development, use localhost
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
};

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
    const {
      questionId,
      answer,
      memoryChoice,
      clientDateTime,
      clientTimeZone,
      clientTimeZoneOffsetMinutes,
    } = body;

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

      // Memory choice selections don't need extraction - they came FROM memory
      return NextResponse.json({ success: true });
    }

    // Check if this is an edit (question already answered)
    const isEdit = question.status === "answered";

    if (isEdit) {
      // Clear all linked field values first before re-parsing
      const clearUpdates = linkedFields.map((f) => ({
        fieldId: f.id,
        value: "",
      }));
      if (clearUpdates.length > 0) {
        await batchUpdateFieldValues(clearUpdates);
        console.log("[AutoForm] Editing answer - cleared previous field values:", {
          documentId,
          questionId,
          clearedFields: clearUpdates.length,
        });
      }
    }

    // Standard answer flow: Parse FIRST, then update status based on result
    // This fixes the race condition where status was set to "answered" before parsing
    if (linkedFields.length > 0) {
      const fieldsForParsing = linkedFields.map((f) => ({
        id: f.id,
        label: f.label,
        fieldType: f.field_type,
        // Include choice options for circle_choice fields so parsing can match exactly
        choiceOptions: f.field_type === "circle_choice" ? (f.choice_options ?? undefined) : undefined,
      }));

      const parseResult = await parseAnswerForFields({
        question: question.question,
        answer,
        fields: fieldsForParsing,
        clientDateTime,
        clientTimeZone,
        clientTimeZoneOffsetMinutes,
      });

      // Fill fields that have values (even if partial)
      const fieldsToUpdate = parseResult.parsedValues.filter(
        ({ value }) => value && value.trim().length > 0
      );

      if (fieldsToUpdate.length > 0) {
        await batchUpdateFieldValues(
          fieldsToUpdate.map(({ fieldId, value }) => ({
            fieldId,
            value,
          }))
        );

        console.log("[AutoForm] Fields updated:", {
          documentId,
          questionId,
          filledCount: fieldsToUpdate.length,
          totalFields: linkedFields.length,
        });
      }

      // Check if there are missing fields that still need values
      const hasMissingFields =
        parseResult.missingFields && parseResult.missingFields.length > 0;

      if (hasMissingFields && parseResult.confident) {
        // Partial fill: update the question to ask only for remaining fields
        // Single status update - no race condition
        const missingFieldIds = parseResult.missingFields!;
        const newQuestion =
          parseResult.followUpQuestion || question.question;

        await updateQuestion(questionId, {
          status: "visible", // Keep visible (not "pending") so user can continue
          answer: undefined, // Clear answer so user can re-answer
          question: newQuestion,
          field_ids: missingFieldIds,
        });

        // Return info about partial fill
        const filledLabels = fieldsToUpdate
          .map(({ fieldId }) => linkedFields.find((f) => f.id === fieldId)?.label)
          .filter(Boolean);

        console.log("[AutoForm] Partial fill - question updated:", {
          documentId,
          questionId,
          filledFields: filledLabels,
          missingFields: missingFieldIds.length,
          newQuestion: newQuestion.slice(0, 50),
        });

        return NextResponse.json({
          success: true,
          partial: true,
          filledFields: filledLabels,
          updatedQuestion: newQuestion,
        });
      } else if (!parseResult.confident) {
        // Not confident at all - keep question visible, don't mark answered
        // Single status update - no race condition
        warning = parseResult.warning;
        console.log("[AutoForm] Answer parsing not confident:", {
          documentId,
          questionId,
          warning,
        });
        // Don't update status - question stays "visible"
        return NextResponse.json({ success: true, warning });
      } else {
        // All fields filled successfully - NOW mark as answered
        // Single status update - no race condition
        await updateQuestion(questionId, {
          status: "answered",
          answer,
        });

        console.log("[AutoForm] Question fully answered:", {
          documentId,
          questionId,
          answer: answer.slice(0, 50),
          linkedFields: linkedFields.length,
          parsedFields: fieldsToUpdate.length,
        });

        // Trigger cross-question auto-fill in background
        triggerCrossQuestionAutoFill(
          documentId,
          questionId,
          { question: question.question, answer },
          questions,
          allFields,
          {
            clientDateTime,
            clientTimeZone,
            clientTimeZoneOffsetMinutes,
          }
        );

        // Trigger memory extraction in background (if enabled)
        triggerMemoryExtraction(
          documentId,
          question.question,
          answer,
          document.use_memory ?? true
        );
      }
    } else {
      // No linked fields - just mark as answered
      await updateQuestion(questionId, {
        status: "answered",
        answer,
      });

      console.log("[AutoForm] Question answered (no linked fields):", {
        documentId,
        questionId,
        answer: answer.slice(0, 50),
      });

      // Trigger cross-question auto-fill in background
      triggerCrossQuestionAutoFill(
        documentId,
        questionId,
        { question: question.question, answer },
        questions,
        allFields,
        {
          clientDateTime,
          clientTimeZone,
          clientTimeZoneOffsetMinutes,
        }
      );

      // Trigger memory extraction in background (if enabled)
      triggerMemoryExtraction(
        documentId,
        question.question,
        answer,
        document.use_memory ?? true
      );
    }

    // Scoped write: Only the linked fields are populated
    return NextResponse.json({ success: true, warning });
  } catch (error) {
    console.error(`[AutoForm] Answer question error:`, error);
    return NextResponse.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}

/**
 * Fire-and-forget: Check if a new answer can auto-fill other pending questions
 * This runs in the background and doesn't block the response
 */
function triggerCrossQuestionAutoFill(
  documentId: string,
  answeredQuestionId: string,
  newAnswer: { question: string; answer: string },
  allQuestions: QuestionGroup[],
  allFields: ExtractedField[],
  clientTime?: {
    clientDateTime?: string;
    clientTimeZone?: string;
    clientTimeZoneOffsetMinutes?: number;
  }
) {
  // Find other visible questions (excluding the one we just answered)
  const pendingQuestions = allQuestions.filter(
    (q) => q.status === "visible" && q.id !== answeredQuestionId
  );

  if (pendingQuestions.length === 0) {
    console.log("[AutoForm] No pending questions to auto-fill");
    return;
  }

  console.log("[AutoForm] Triggering cross-question auto-fill:", {
    documentId,
    pendingCount: pendingQuestions.length,
  });

  // Run in background - don't block the response
  (async () => {
    try {
      const autoAnswers = await reevaluatePendingQuestions({
        newAnswer,
        pendingQuestions: pendingQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          fieldIds: q.field_ids,
        })),
        fields: allFields,
        clientDateTime: clientTime?.clientDateTime,
        clientTimeZone: clientTime?.clientTimeZone,
        clientTimeZoneOffsetMinutes: clientTime?.clientTimeZoneOffsetMinutes,
      });

      if (autoAnswers.length === 0) {
        console.log("[AutoForm] No questions could be auto-filled");
        return;
      }

      console.log("[AutoForm] Auto-filling questions:", {
        documentId,
        count: autoAnswers.length,
      });

      // Apply auto-answers
      for (const aa of autoAnswers) {
        try {
          const question = pendingQuestions.find((q) => q.id === aa.questionId);
          if (!question) continue;

          // Mark question as answered
          await updateQuestion(aa.questionId, {
            status: "answered",
            answer: aa.answer,
          });

          // Update field values
          if (question.field_ids.length > 0) {
            await batchUpdateFieldValues(
              question.field_ids.map((fieldId) => ({
                fieldId,
                value: aa.answer,
              }))
            );
          }

          console.log("[AutoForm] Auto-filled question:", {
            questionId: aa.questionId,
            answer: aa.answer.slice(0, 50),
            reasoning: aa.reasoning,
          });
        } catch (err) {
          console.error("[AutoForm] Failed to auto-fill question:", {
            questionId: aa.questionId,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    } catch (err) {
      console.error("[AutoForm] Cross-question auto-fill failed:", {
        documentId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  })();
}

/**
 * Fire-and-forget: Extract entities from a new answer for memory storage
 * Only runs if use_memory is enabled for the document
 */
function triggerMemoryExtraction(
  documentId: string,
  question: string,
  answer: string,
  useMemory: boolean
) {
  // Skip if memory is disabled for this document
  if (!useMemory) {
    console.log("[AutoForm] Memory extraction skipped - use_memory is false");
    return;
  }

  // Skip short/boolean answers
  const lowerAnswer = answer.toLowerCase().trim();
  if (
    answer.trim().length < 3 ||
    ["yes", "no", "true", "false", "n/a", "na", "none"].includes(lowerAnswer)
  ) {
    console.log("[AutoForm] Memory extraction skipped - non-informative answer");
    return;
  }

  console.log("[AutoForm] Triggering background memory extraction:", {
    documentId,
    questionPreview: question.slice(0, 50),
    answerPreview: answer.slice(0, 50),
  });

  // Fire-and-forget API call to extract endpoint
  fetch(`${getBaseUrl()}/api/memories/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      answer,
      documentId,
    }),
  }).catch((error) => {
    console.error("[AutoForm] Memory extraction request failed:", error);
  });
}
