"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { QuestionCard } from "./QuestionCard";
import { ProcessingOverlay } from "./ProcessingOverlay";
import type { QuestionGroup, ProcessingProgress } from "@/lib/types";

interface AIWizardPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: QuestionGroup[];
  progress: ProcessingProgress | null;
  currentQuestionIndex: number;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  answering: string | null;
  onGoToQuestion: (questionId: string) => void;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

export function AIWizardPanel({
  open,
  onOpenChange,
  questions,
  progress,
  currentQuestionIndex,
  onAnswer,
  answering,
  onGoToQuestion,
}: AIWizardPanelProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");

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

  const content = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Stats */}
      <div className="px-4 pb-4 border-b flex-shrink-0">
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

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <div className="flex items-center justify-between">
              <DrawerTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Smart Assist
              </DrawerTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[450px] p-0">
        <SheetHeader className="p-4 pb-2 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Smart Assist
            </SheetTitle>
          </div>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}

// Floating trigger button for opening the wizard
interface WizardTriggerProps {
  onClick: () => void;
  questionCount: number;
  isProcessing: boolean;
}

export function WizardTrigger({
  onClick,
  questionCount,
  isProcessing,
}: WizardTriggerProps) {
  return (
    <Button
      onClick={onClick}
      className="fixed bottom-6 right-6 shadow-lg gap-2 z-50"
      size="lg"
    >
      <Sparkles className="w-5 h-5" />
      {isProcessing ? (
        "Processing..."
      ) : questionCount > 0 ? (
        `${questionCount} Questions`
      ) : (
        "Smart Assist"
      )}
      <ChevronUp className="w-4 h-4" />
    </Button>
  );
}
