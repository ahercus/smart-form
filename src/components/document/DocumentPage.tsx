"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { FolderOpen, Save, Download, Loader2, Sparkles } from "lucide-react";
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
  const [scrollToQuestionId, setScrollToQuestionId] = useState<string | null>(null);
  const [scrollToFieldId, setScrollToFieldId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

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
    currentQuestion,
    currentQuestionIndex,
    answering,
    answerQuestion,
    goToQuestion,
    progress: questionProgress,
  } = useQuestions({ questions, documentId });

  // Get highlighted field IDs from current question
  const highlightedFieldIds = currentQuestion?.field_ids || [];

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

  // Validate documentId is a valid UUID
  const isValidId = documentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);

  // Fetch PDF URL - can be called on mount or to refresh expired URL
  const fetchPdfUrl = useCallback(async () => {
    if (!isValidId) return;

    try {
      const response = await fetch(`/api/documents/${documentId}/pdf`);
      if (response.ok) {
        const data = await response.json();
        setPdfUrl(data.url);
        console.log("[AutoForm] PDF URL fetched successfully");
      } else {
        console.error("[AutoForm] Failed to fetch PDF URL:", response.status);
        toast.error("Failed to load PDF");
      }
    } catch (error) {
      console.error("[AutoForm] Failed to fetch PDF URL:", error);
      toast.error("Failed to load PDF");
    }
  }, [documentId, isValidId]);

  // Initial PDF URL fetch
  useEffect(() => {
    if (isValidId) {
      fetchPdfUrl();
    }
  }, [isValidId, fetchPdfUrl]);

  // Handle PDF load error - refresh the signed URL
  const handlePdfLoadError = useCallback(() => {
    console.log("[AutoForm] PDF load error, refreshing URL...");
    toast("Refreshing PDF...", { duration: 2000 });
    fetchPdfUrl();
  }, [fetchPdfUrl]);

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

  // Handle navigate to question for a field (when field is clicked)
  const handleNavigateToQuestion = useCallback(
    (fieldId: string) => {
      // Find the question that contains this field
      const question = questions.find((q) => q.field_ids.includes(fieldId));
      if (question) {
        goToQuestion(question.id);
        // Trigger scroll to question
        setScrollToQuestionId(question.id);
        // Clear after a tick to allow re-triggering
        setTimeout(() => setScrollToQuestionId(null), 100);
      }
    },
    [questions, goToQuestion]
  );

  // Handle clicking on a question - navigate to its page and scroll field into view
  const handleGoToQuestion = useCallback(
    (questionId: string) => {
      const question = questions.find((q) => q.id === questionId);
      if (question) {
        // Navigate to the page containing the first field
        if (question.field_ids.length > 0) {
          const firstFieldId = question.field_ids[0];
          const firstField = fields.find((f) => f.id === firstFieldId);
          if (firstField) {
            if (firstField.page_number !== currentPage) {
              setCurrentPage(firstField.page_number);
            }
            // Set active field and trigger scroll
            setActiveFieldId(firstFieldId);
            setScrollToFieldId(firstFieldId);
            // Clear after a tick to allow re-triggering
            setTimeout(() => setScrollToFieldId(null), 100);
          }
        }
        // Update the current question index
        goToQuestion(questionId);
      }
    },
    [questions, fields, currentPage, goToQuestion]
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

  // Handle PDF export
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Save any pending changes first
      if (hasUnsavedChanges) {
        await saveFieldUpdates();
      }

      const response = await fetch(`/api/documents/${documentId}/export`);
      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = `${document?.original_filename?.replace(/\.pdf$/i, "") || "document"}_filled.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("PDF exported successfully");
    } catch (error) {
      console.error("[AutoForm] Export error:", error);
      toast.error("Failed to export PDF");
    } finally {
      setExporting(false);
    }
  }, [documentId, document, hasUnsavedChanges, saveFieldUpdates]);

  // Check if still processing
  const isProcessing =
    progress &&
    progress.phase !== "ready" &&
    progress.phase !== "idle" &&
    progress.phase !== "failed";

  // Check if in early processing phase (show blur overlay)
  // PDF stays blurred until fields have been QC'd by Gemini
  const isEarlyProcessing =
    !document ||
    document.status === "uploading" ||
    document.status === "analyzing" ||
    document.status === "refining" ||
    !document.fields_qc_complete;

  // Processing phase labels
  const getProcessingLabel = () => {
    if (!document) return "Loading document...";
    if (document.status === "uploading") return "Uploading document...";
    if (document.status === "analyzing") return "Analyzing with AI...";
    if (document.status === "extracting") return "Extracting form fields...";
    if (document.status === "refining" || !document.fields_qc_complete) return "Refining field detection...";
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
              <FolderOpen className="mr-2 h-4 w-4" />
              Manage Files
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
              <FolderOpen className="mr-2 h-4 w-4" />
              Manage Files
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
                <Button variant="ghost" size="sm">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Manage Files
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
              <Button
                onClick={handleExport}
                disabled={isEarlyProcessing || exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {exporting ? "Exporting..." : "Export PDF"}
              </Button>
            </div>
          </div>
          <Progress value={isEarlyProcessing ? 0 : completionStats.percentage} className="mt-3 h-2" />
        </div>
      </div>

      {/* Main Content - Resizable Panels */}
      <div className="h-[calc(100vh-100px)]">
        <ResizablePanelGroup
          orientation={isMobile ? "vertical" : "horizontal"}
          className="h-full"
        >
          {/* PDF Panel */}
          <ResizablePanel defaultSize={isMobile ? 50 : 65} minSize={isMobile ? 30 : 40}>
            <div className={`h-full relative ${isMobile ? "border-b" : "border-r"}`}>
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
                    highlightedFieldIds={highlightedFieldIds}
                    onPageRender={handlePageRender}
                    onLoadError={handlePdfLoadError}
                    scrollToFieldId={scrollToFieldId}
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
          <ResizablePanel defaultSize={isMobile ? 50 : 35} minSize={isMobile ? 30 : 25}>
            <QuestionsPanel
              documentId={documentId}
              document={document}
              questions={questions}
              progress={progress}
              currentQuestionIndex={currentQuestionIndex}
              onAnswer={handleAnswerQuestion}
              answering={answering}
              onGoToQuestion={handleGoToQuestion}
              scrollToQuestionId={scrollToQuestionId}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
