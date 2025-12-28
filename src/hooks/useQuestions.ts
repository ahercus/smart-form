"use client";

import { useState, useCallback, useMemo } from "react";
import type { QuestionGroup, MemoryChoice } from "@/lib/types";

interface UseQuestionsParams {
  questions: QuestionGroup[];
  documentId: string;
}

export function useQuestions({ questions, documentId }: UseQuestionsParams) {
  const [answering, setAnswering] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Filter to visible questions only
  const visibleQuestions = useMemo(
    () => questions.filter((q) => q.status === "visible"),
    [questions]
  );

  const answeredQuestions = useMemo(
    () => questions.filter((q) => q.status === "answered"),
    [questions]
  );

  const currentQuestion = visibleQuestions[currentQuestionIndex] || null;

  const progress = useMemo(() => {
    const total = questions.length;
    const answered = answeredQuestions.length;
    return total > 0 ? (answered / total) * 100 : 0;
  }, [questions.length, answeredQuestions.length]);

  const answerQuestion = useCallback(
    async (questionId: string, answer: string) => {
      setAnswering(questionId);

      try {
        const response = await fetch(
          `/api/documents/${documentId}/questions`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questionId, answer }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to answer question");
        }

        const result = await response.json();

        console.log("[AutoForm] Question answered:", {
          questionId,
          autoAnswered: result.autoAnswered,
        });

        // Move to next question if current one was answered
        if (questionId === currentQuestion?.id) {
          // The question will be removed from visibleQuestions via realtime
          // so we don't need to increment the index
        }

        return result;
      } catch (error) {
        console.error("[AutoForm] Failed to answer question:", error);
        throw error;
      } finally {
        setAnswering(null);
      }
    },
    [documentId, currentQuestion?.id]
  );

  const answerMemoryChoice = useCallback(
    async (questionId: string, choice: MemoryChoice) => {
      setAnswering(questionId);

      try {
        const response = await fetch(
          `/api/documents/${documentId}/questions`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questionId, memoryChoice: choice }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to answer question");
        }

        const result = await response.json();

        console.log("[AutoForm] Memory choice answered:", {
          questionId,
          choiceLabel: choice.label,
        });

        return result;
      } catch (error) {
        console.error("[AutoForm] Failed to answer memory choice:", error);
        throw error;
      } finally {
        setAnswering(null);
      }
    },
    [documentId]
  );

  const goToNext = useCallback(() => {
    if (currentQuestionIndex < visibleQuestions.length - 1) {
      setCurrentQuestionIndex((i) => i + 1);
    }
  }, [currentQuestionIndex, visibleQuestions.length]);

  const goToPrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((i) => i - 1);
    }
  }, [currentQuestionIndex]);

  const goToQuestion = useCallback(
    (questionId: string) => {
      const index = visibleQuestions.findIndex((q) => q.id === questionId);
      if (index >= 0) {
        setCurrentQuestionIndex(index);
      }
    },
    [visibleQuestions]
  );

  return {
    questions,
    visibleQuestions,
    answeredQuestions,
    currentQuestion,
    currentQuestionIndex,
    progress,
    answering,
    answerQuestion,
    answerMemoryChoice,
    goToNext,
    goToPrev,
    goToQuestion,
  };
}
