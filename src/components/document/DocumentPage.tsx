"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ArrowLeft, Save, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PDFWithOverlays } from "./PDFWithOverlays";
import { QuestionsPanel } from "./QuestionsPanel";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useQuestions } from "@/hooks/useQuestions";
import { useFieldSync } from "@/hooks/useFieldSync";
import { usePageImageUpload } from "@/hooks/usePageImageUpload";
import type { NormalizedCoordinates } from "@/lib/types";

interface DocumentPageProps {
  documentId: string;
}

export function DocumentPage({ documentId }: DocumentPageProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Realtime data subscription
  const {
    document,
    fields,
    questions,
    progress,
    loading,
    error,
  } = useDocumentRealtime(documentId);

  // Question management
  const {
    visibleQuestions,
    currentQuestionIndex,
    answering,
    answerQuestion,
    goToQuestion,
    progress: questionProgress,
  } = useQuestions({ questions, documentId });

  // Field sync
  const {
    fieldValues,
    onFieldChange,
    saveFieldUpdates,
    saving,
    hasUnsavedChanges,
    completionStats,
  } = useFieldSync({ fields, questions, documentId });

  // Page image upload for Gemini vision
  const { capturePageImage } = usePageImageUpload({
    documentId,
    totalPages: document?.page_count || 0,
  });

  // Handle page render - capture and upload image for Gemini
  const handlePageRender = useCallback(
    (pageNumber: number, canvas: HTMLCanvasElement) => {
      capturePageImage(pageNumber, canvas);
    },
    [capturePageImage]
  );

  // Fetch PDF URL
  useEffect(() => {
    const fetchPdfUrl = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/pdf`);
        if (response.ok) {
          const data = await response.json();
          setPdfUrl(data.url);
        }
      } catch (error) {
        console.error("[AutoForm] Failed to fetch PDF URL:", error);
      }
    };

    if (documentId) {
      fetchPdfUrl();
    }
  }, [documentId]);

  // Handle field click - navigate to field's page and highlight it
  const handleFieldClick = useCallback((fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId);
    if (field && field.page_number !== currentPage) {
      setCurrentPage(field.page_number);
    }
    setActiveFieldId(fieldId);
  }, [fields, currentPage]);

  // Handle field coordinates change (move/resize)
  const handleFieldCoordinatesChange = useCallback(
    async (fieldId: string, coords: NormalizedCoordinates) => {
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldId, coordinates: coords }),
        });

        if (!response.ok) {
          throw new Error("Failed to update field coordinates");
        }

        console.log("[AutoForm] Field coordinates updated:", { fieldId, coords });
      } catch (error) {
        console.error("[AutoForm] Failed to update coordinates:", error);
        toast.error("Failed to move field");
      }
    },
    [documentId]
  );

  // Handle field copy
  const handleFieldCopy = useCallback(
    async (fieldId: string) => {
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceFieldId: fieldId }),
        });

        if (!response.ok) {
          throw new Error("Failed to copy field");
        }

        const { field } = await response.json();
        toast.success("Field copied");
        setActiveFieldId(field.id);
      } catch (error) {
        console.error("[AutoForm] Failed to copy field:", error);
        toast.error("Failed to copy field");
      }
    },
    [documentId]
  );

  // Handle field delete
  const handleFieldDelete = useCallback(
    async (fieldId: string) => {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/fields?fieldId=${fieldId}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          throw new Error("Failed to delete field");
        }

        setActiveFieldId(null);
        toast.success("Field deleted");
      } catch (error) {
        console.error("[AutoForm] Failed to delete field:", error);
        toast.error("Failed to delete field");
      }
    },
    [documentId]
  );

  // Handle add new field
  const handleFieldAdd = useCallback(
    async (pageNumber: number, coords: NormalizedCoordinates) => {
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumber, coordinates: coords }),
        });

        if (!response.ok) {
          throw new Error("Failed to add field");
        }

        const { field } = await response.json();
        toast.success("Field added");
        setActiveFieldId(field.id);
      } catch (error) {
        console.error("[AutoForm] Failed to add field:", error);
        toast.error("Failed to add field");
      }
    },
    [documentId]
  );

  // Handle navigate to question for a field
  const handleNavigateToQuestion = useCallback(
    (fieldId: string) => {
      // Find the question that contains this field
      const question = questions.find((q) => q.field_ids.includes(fieldId));
      if (question) {
        goToQuestion(question.id);
      }
    },
    [questions, goToQuestion]
  );

  // Handle answering a question
  const handleAnswerQuestion = useCallback(
    async (questionId: string, answer: string) => {
      try {
        await answerQuestion(questionId, answer);
        toast.success("Answer saved");
      } catch {
        toast.error("Failed to save answer");
      }
    },
    [answerQuestion]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    try {
      await saveFieldUpdates();
      toast.success("Progress saved");
    } catch {
      toast.error("Failed to save");
    }
  }, [saveFieldUpdates]);

  // Auto-save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      if (hasUnsavedChanges) {
        saveFieldUpdates().catch(console.error);
      }
    };
  }, [hasUnsavedChanges, saveFieldUpdates]);

  // Check if still processing
  const isProcessing =
    progress &&
    progress.phase !== "ready" &&
    progress.phase !== "idle" &&
    progress.phase !== "failed";

  // Check if in early processing phase (show blur overlay)
  const isEarlyProcessing =
    !document ||
    document.status === "uploading" ||
    document.status === "analyzing" ||
    (progress?.phase === "parsing");

  // Processing phase labels
  const getProcessingLabel = () => {
    if (!document) return "Loading document...";
    if (document.status === "uploading") return "Uploading document...";
    if (document.status === "analyzing") return "Analyzing with AI...";
    if (progress?.phase === "parsing") return "Extracting form fields...";
    if (progress?.phase === "displaying") return "Generating questions...";
    if (progress?.phase === "enhancing") return "Enhancing with AI...";
    return "Processing...";
  };

  if (loading && !document) {
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-8 w-64 mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !document) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">
            {error || "Document not found"}
          </h2>
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (document?.status === "failed") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">
            Document processing failed
          </h2>
          {document.error_message && (
            <p className="text-destructive mb-4">{document.error_message}</p>
          )}
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="font-semibold truncate max-w-[300px]">
                  {document?.original_filename || "Loading..."}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isEarlyProcessing ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {getProcessingLabel()}
                    </span>
                  ) : (
                    `${completionStats.filled} of ${completionStats.total} fields completed`
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges || isEarlyProcessing}
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : hasUnsavedChanges ? "Save" : "Saved"}
              </Button>
              <Button disabled={isEarlyProcessing}>
                <Download className="mr-2 h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>
          <Progress value={isEarlyProcessing ? 0 : completionStats.percentage} className="mt-3 h-2" />
        </div>
      </div>

      {/* Main Content - Resizable Panels */}
      <div className="h-[calc(100vh-100px)]">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {/* PDF Panel */}
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full relative border-r">
              {/* PDF Content */}
              <div className={`h-full ${isEarlyProcessing ? "blur-sm pointer-events-none" : ""}`}>
                {pdfUrl ? (
                  <PDFWithOverlays
                    url={pdfUrl}
                    fields={fields}
                    fieldValues={fieldValues}
                    currentPage={currentPage}
                    onPageChange={setCurrentPage}
                    onFieldChange={onFieldChange}
                    onFieldClick={handleFieldClick}
                    onFieldCoordinatesChange={handleFieldCoordinatesChange}
                    onFieldCopy={handleFieldCopy}
                    onFieldDelete={handleFieldDelete}
                    onFieldAdd={handleFieldAdd}
                    onNavigateToQuestion={handleNavigateToQuestion}
                    activeFieldId={activeFieldId}
                    onPageRender={handlePageRender}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Skeleton className="h-[600px] w-full max-w-[600px]" />
                  </div>
                )}
              </div>

              {/* Processing Overlay */}
              {isEarlyProcessing && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
                  <div className="text-center space-y-4 p-8 rounded-xl bg-card border shadow-lg max-w-md">
                    <div className="flex items-center justify-center gap-3">
                      <Sparkles className="h-8 w-8 text-primary animate-pulse" />
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{getProcessingLabel()}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        This usually takes 10-30 seconds
                      </p>
                    </div>
                    {progress && progress.pagesTotal > 0 && (
                      <div className="space-y-2">
                        <Progress
                          value={(progress.pagesComplete / progress.pagesTotal) * 100}
                          className="h-2"
                        />
                        <p className="text-xs text-muted-foreground">
                          {progress.pagesComplete} / {progress.pagesTotal} pages processed
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Questions Panel */}
          <ResizablePanel defaultSize={35} minSize={25}>
            <QuestionsPanel
              questions={questions}
              progress={progress}
              currentQuestionIndex={currentQuestionIndex}
              onAnswer={handleAnswerQuestion}
              answering={answering}
              onGoToQuestion={goToQuestion}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
