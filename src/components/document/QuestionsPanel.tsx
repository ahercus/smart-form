"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QuestionCard } from "./QuestionCard";
import { ProcessingOverlay } from "./ProcessingOverlay";
import { ContextInputPanel } from "./ContextInputPanel";
import { useMemories } from "@/hooks/useMemories";
import type { QuestionGroup, ProcessingProgress, Document, SignatureType } from "@/lib/types";

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
  answering: string | null;
  onGoToQuestion: (questionId: string) => void;
  scrollToQuestionId?: string | null;
  onOpenSignatureManager?: (fieldIds: string[], type: SignatureType, questionId?: string) => void;
  loading?: boolean;
}

export function QuestionsPanel({
  documentId,
  document,
  questions,
  progress,
  currentQuestionIndex,
  currentPage,
  onAnswer,
  answering,
  onGoToQuestion,
  scrollToQuestionId,
  onOpenSignatureManager,
  loading,
}: QuestionsPanelProps) {
  const questionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Memory state
  const { bundles, addMemory } = useMemories();
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryBundleId, setMemoryBundleId] = useState("");
  const [memorySourceQuestion, setMemorySourceQuestion] = useState("");
  const [memorySubmitting, setMemorySubmitting] = useState(false);

  const handleSaveToMemory = (question: string, answer: string) => {
    // Pre-fill with Q&A format
    setMemoryContent(answer);
    setMemorySourceQuestion(question);
    setMemoryBundleId(bundles[0]?.id || "");
    setMemoryDialogOpen(true);
  };

  const handleMemorySubmit = async () => {
    if (!memoryContent.trim() || !memoryBundleId) return;

    setMemorySubmitting(true);
    try {
      await addMemory(memoryBundleId, memoryContent.trim(), {
        documentId,
        question: memorySourceQuestion,
      });
      toast.success("Saved to memory");
      setMemoryDialogOpen(false);
    } catch {
      toast.error("Failed to save to memory");
    } finally {
      setMemorySubmitting(false);
    }
  };

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

  const isProcessing =
    progress &&
    progress.phase !== "ready" &&
    progress.phase !== "idle" &&
    progress.phase !== "failed";

  // Show context input if:
  // 1. Document exists AND
  // 2. Context hasn't been submitted yet AND
  // 3. Either still processing OR no questions yet
  const showContextInput =
    document &&
    !document.context_submitted &&
    (isProcessing || totalQuestions === 0);

  // If showing context input, render the full-height ContextInputPanel
  if (showContextInput) {
    return (
      <ContextInputPanel
        documentId={documentId}
        document={document}
        progress={progress}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
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

      {/* Content - Scrollable (independent from PDF) */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {isProcessing ? (
          <ProcessingOverlay progress={progress} />
        ) : questionsByPage.length > 0 ? (
          <div className="space-y-4">
            {questionsByPage.map(([pageNumber, pageQuestions], pageIndex) => (
              <div
                key={pageNumber}
                ref={(el) => {
                  if (el) pageRefs.current.set(pageNumber, el);
                }}
              >
                {/* Page divider */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground px-2">
                    Page {pageNumber}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Questions for this page */}
                <div className="space-y-3">
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
                          isAnswering={answering === question.id}
                          onClick={() => onGoToQuestion(question.id)}
                          onOpenSignatureManager={onOpenSignatureManager}
                          documentId={documentId}
                          onSaveToMemory={handleSaveToMemory}
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
              <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="font-medium">All questions answered!</p>
            <p className="text-sm text-muted-foreground mt-1">
              You can still edit fields directly on the PDF
            </p>
          </div>
        ) : loading ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading questions...</span>
            </div>
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-3/4" />
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No questions yet</p>
            <p className="text-sm mt-1">
              Questions will appear as the document is processed
            </p>
          </div>
        )}
      </div>

      {/* Save to Memory Dialog */}
      <Dialog open={memoryDialogOpen} onOpenChange={setMemoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to Memory</DialogTitle>
            <DialogDescription>
              Save this information for future auto-fill
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={memoryBundleId} onValueChange={setMemoryBundleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {bundles.map((bundle) => (
                    <SelectItem key={bundle.id} value={bundle.id}>
                      {bundle.icon} {bundle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Memory</Label>
              <Textarea
                placeholder="Information to remember..."
                value={memoryContent}
                onChange={(e) => setMemoryContent(e.target.value)}
                rows={3}
              />
              {memorySourceQuestion && (
                <p className="text-xs text-muted-foreground">
                  From: {memorySourceQuestion}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMemorySubmit}
              disabled={!memoryContent.trim() || !memoryBundleId || memorySubmitting}
            >
              {memorySubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
