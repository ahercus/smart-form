"use client";

import { Progress } from "@/components/ui/progress";
import { Sparkles } from "lucide-react";
import { QuestionCard } from "./QuestionCard";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { QuestionGroup, ProcessingProgress } from "@/lib/types";

interface QuestionsPanelProps {
  questions: QuestionGroup[];
  progress: ProcessingProgress | null;
  currentQuestionIndex: number;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  answering: string | null;
  onGoToQuestion: (questionId: string) => void;
}

export function QuestionsPanel({
  questions,
  progress,
  currentQuestionIndex,
  onAnswer,
  answering,
}: QuestionsPanelProps) {
  const visibleQuestions = questions.filter((q) => q.status === "visible");
  const answeredQuestions = questions.filter((q) => q.status === "answered");
  const totalQuestions = questions.length;
  const progressPercentage =
    totalQuestions > 0 ? (answeredQuestions.length / totalQuestions) * 100 : 0;

  const isProcessing =
    progress &&
    progress.phase !== "ready" &&
    progress.phase !== "idle" &&
    progress.phase !== "failed";

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">AI Assistant</h2>
        </div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">
            {answeredQuestions.length} of {totalQuestions} answered
          </span>
          <span className="font-medium">{Math.round(progressPercentage)}%</span>
        </div>
        <Progress value={progressPercentage} className="h-2" />
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
        {isProcessing ? (
          <ProcessingOverlay progress={progress} />
        ) : visibleQuestions.length > 0 ? (
          <div className="space-y-3">
            {visibleQuestions.map((question, index) => (
              <QuestionCard
                key={question.id}
                question={question}
                isActive={index === currentQuestionIndex}
                onAnswer={(answer) => onAnswer(question.id, answer)}
                isAnswering={answering === question.id}
              />
            ))}
          </div>
        ) : totalQuestions > 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="font-medium">All questions answered!</p>
            <p className="text-sm text-muted-foreground mt-1">
              You can still edit fields directly on the PDF
            </p>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No questions yet</p>
            <p className="text-sm mt-1">
              Questions will appear as the document is processed
            </p>
          </div>
        )}

        {/* Answered questions section */}
        {answeredQuestions.length > 0 && visibleQuestions.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-sm font-medium text-muted-foreground mb-3">
              Answered ({answeredQuestions.length})
            </p>
            <div className="space-y-2">
              {answeredQuestions.map((question) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  isActive={false}
                  onAnswer={() => Promise.resolve()}
                  isAnswering={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
