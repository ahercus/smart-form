"use client";

import { useRef, useEffect, useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { CheckCircle } from "lucide-react";
import { QuestionCard } from "./QuestionCard";
import type { QuestionGroup, ProcessingProgress, Document, SignatureType, MemoryChoice } from "@/lib/types";

export interface QuestionsPanelRef {
  scrollToQuestion: (questionId: string) => void;
}

interface QuestionsPanelProps {
  documentId: string;
  document: Document | null;
  questions: QuestionGroup[];
  progress: ProcessingProgress | null;
  currentQuestionIndex: number;
  currentPage: number;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onAnswerMemoryChoice?: (questionId: string, choice: MemoryChoice) => Promise<void>;
  answering: string | null;
  onGoToQuestion: (questionId: string) => void;
  scrollToQuestionId?: string | null;
  onOpenSignatureManager?: (fieldIds: string[], type: SignatureType, questionId?: string) => void;
  loading?: boolean;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function QuestionsPanel({
  documentId,
  document,
  questions,
  progress,
  currentQuestionIndex,
  currentPage,
  onAnswer,
  onAnswerMemoryChoice,
  answering,
  onGoToQuestion,
  scrollToQuestionId,
  onOpenSignatureManager,
  loading,
  onClose,
  expanded,
  onToggleExpand,
}: QuestionsPanelProps) {
  const questionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter out signature/initials questions - those are handled by clicking the field directly
  const nonSignatureQuestions = questions.filter(
    (q) => q.input_type !== "signature" && q.input_type !== "initials"
  );

  const visibleQuestions = nonSignatureQuestions.filter((q) => q.status === "visible");
  const answeredQuestions = nonSignatureQuestions.filter((q) => q.status === "answered");
  const totalQuestions = nonSignatureQuestions.length;
  const progressPercentage =
    totalQuestions > 0 ? (answeredQuestions.length / totalQuestions) * 100 : 0;

  // Group all questions (visible + answered) by page number
  const questionsByPage = useMemo(() => {
    const allQuestions = [...visibleQuestions, ...answeredQuestions];
    const grouped = new Map<number, QuestionGroup[]>();

    for (const q of allQuestions) {
      const pageQuestions = grouped.get(q.page_number) || [];
      pageQuestions.push(q);
      grouped.set(q.page_number, pageQuestions);
    }

    // Sort by page number and return as array of [pageNumber, questions]
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  }, [visibleQuestions, answeredQuestions]);

  // Scroll to question when scrollToQuestionId changes
  useEffect(() => {
    if (scrollToQuestionId) {
      const element = questionRefs.current.get(scrollToQuestionId);
      if (element && scrollContainerRef.current) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [scrollToQuestionId]);

  // Auto-scroll to page section when currentPage changes
  useEffect(() => {
    const pageElement = pageRefs.current.get(currentPage);
    if (pageElement && scrollContainerRef.current) {
      pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentPage]);

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Assistant</h2>
        </div>
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="text-muted-foreground">
            {answeredQuestions.length} of {totalQuestions} answered
          </span>
          <span className="font-medium">{Math.round(progressPercentage)}%</span>
        </div>
        <Progress value={progressPercentage} className="h-1.5" />
      </div>

      {/* Content - Scrollable (independent from PDF) */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {questionsByPage.length > 0 ? (
          <div className="space-y-3">
            {questionsByPage.map(([pageNumber, pageQuestions], pageIndex) => (
              <div
                key={pageNumber}
                ref={(el) => {
                  if (el) pageRefs.current.set(pageNumber, el);
                }}
              >
                {/* Page divider */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground px-2">
                    Page {pageNumber}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Questions for this page */}
                <div className="space-y-2">
                  {pageQuestions.map((question) => {
                    const visibleIndex = visibleQuestions.findIndex((q) => q.id === question.id);
                    return (
                      <div
                        key={question.id}
                        ref={(el) => {
                          if (el) questionRefs.current.set(question.id, el);
                        }}
                      >
                        <QuestionCard
                          question={question}
                          isActive={visibleIndex === currentQuestionIndex}
                          onAnswer={(answer) => onAnswer(question.id, answer)}
                          onMemoryChoiceSelect={
                            onAnswerMemoryChoice
                              ? (choice) => onAnswerMemoryChoice(question.id, choice)
                              : undefined
                          }
                          isAnswering={answering === question.id}
                          onClick={() => onGoToQuestion(question.id)}
                          onOpenSignatureManager={onOpenSignatureManager}
                          documentId={documentId}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : totalQuestions > 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="font-medium">All questions answered!</p>
            <p className="text-sm text-muted-foreground mt-1">
              You can still edit fields directly on the PDF
            </p>
          </div>
        ) : (
          /* Shimmer skeleton cards while loading */
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="relative h-20 rounded-lg bg-muted/50 overflow-hidden"
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,107,107,0.1), rgba(254,202,87,0.1), rgba(72,219,251,0.1), rgba(255,159,243,0.1), rgba(84,160,255,0.1), transparent)",
                    backgroundSize: "200% 100%",
                    animation: "shimmer 2s linear infinite",
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
