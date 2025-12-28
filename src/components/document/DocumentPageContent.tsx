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
import { Save, Download, Loader2, Sparkles, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { PDFWithOverlays } from "./PDFWithOverlays";
import { QuestionsPanel } from "./QuestionsPanel";
import { SignatureManager } from "@/components/signature";
import { AppHeader } from "@/components/layout";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useQuestions } from "@/hooks/useQuestions";
import { useFieldSync } from "@/hooks/useFieldSync";
import { usePageImageUpload } from "@/hooks/usePageImageUpload";
import type { NormalizedCoordinates, SignatureType } from "@/lib/types";

interface DocumentPageContentProps {
  documentId: string;
}

export function DocumentPageContent({ documentId }: DocumentPageContentProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [scrollToQuestionId, setScrollToQuestionId] = useState<string | null>(
    null
  );
  const [scrollToFieldId, setScrollToFieldId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureContext, setSignatureContext] = useState<{
    fieldIds: string[];
    type: SignatureType;
    questionId?: string;
  } | null>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { document, fields, questions, progress, loading, error } =
    useDocumentRealtime(documentId);

  const {
    currentQuestion,
    currentQuestionIndex,
    answering,
    answerQuestion,
    goToQuestion,
  } = useQuestions({ questions, documentId });

  const highlightedFieldIds = currentQuestion?.field_ids || [];

  const {
    fieldValues,
    onFieldChange,
    saveFieldUpdates,
    saving,
    hasUnsavedChanges,
    completionStats,
  } = useFieldSync({ fields, questions, documentId });

  const { capturePageImage } = usePageImageUpload({
    documentId,
    totalPages: document?.page_count || 0,
  });

  const handlePageRender = useCallback(
    (pageNumber: number, canvas: HTMLCanvasElement) => {
      capturePageImage(pageNumber, canvas);
    },
    [capturePageImage]
  );

  const isValidId =
    documentId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      documentId
    );

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

  useEffect(() => {
    if (isValidId) {
      fetchPdfUrl();
    }
  }, [isValidId, fetchPdfUrl]);

  const handlePdfLoadError = useCallback(() => {
    console.log("[AutoForm] PDF load error, refreshing URL...");
    toast("Refreshing PDF...", { duration: 2000 });
    fetchPdfUrl();
  }, [fetchPdfUrl]);

  const handleFieldClick = useCallback(
    (fieldId: string) => {
      const field = fields.find((f) => f.id === fieldId);
      if (field && field.page_number !== currentPage) {
        setCurrentPage(field.page_number);
      }
      setActiveFieldId(fieldId);
    },
    [fields, currentPage]
  );

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

        console.log("[AutoForm] Field coordinates updated:", {
          fieldId,
          coords,
        });
      } catch (error) {
        console.error("[AutoForm] Failed to update coordinates:", error);
        toast.error("Failed to move field");
      }
    },
    [documentId]
  );

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

  const handleNavigateToQuestion = useCallback(
    (fieldId: string) => {
      const question = questions.find((q) => q.field_ids.includes(fieldId));
      if (question) {
        goToQuestion(question.id);
        setScrollToQuestionId(question.id);
        setTimeout(() => setScrollToQuestionId(null), 100);
      }
    },
    [questions, goToQuestion]
  );

  const handleGoToQuestion = useCallback(
    (questionId: string) => {
      const question = questions.find((q) => q.id === questionId);
      if (question) {
        if (question.field_ids.length > 0) {
          const firstFieldId = question.field_ids[0];
          const firstField = fields.find((f) => f.id === firstFieldId);
          if (firstField) {
            if (firstField.page_number !== currentPage) {
              setCurrentPage(firstField.page_number);
            }
            setActiveFieldId(firstFieldId);
            setScrollToFieldId(firstFieldId);
            setTimeout(() => setScrollToFieldId(null), 100);
          }
        }
        goToQuestion(questionId);
      }
    },
    [questions, fields, currentPage, goToQuestion]
  );

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

  const handleOpenSignatureManager = useCallback(
    (fieldIds: string[], type: SignatureType, questionId?: string) => {
      setSignatureContext({ fieldIds, type, questionId });
      setShowSignatureManager(true);
    },
    []
  );

  const handleSignatureInsert = useCallback(
    async (dataUrl: string, type: SignatureType) => {
      if (signatureContext) {
        for (const fieldId of signatureContext.fieldIds) {
          onFieldChange(fieldId, dataUrl);
        }

        if (signatureContext.questionId) {
          try {
            await answerQuestion(signatureContext.questionId, dataUrl);
          } catch {
            console.error("[AutoForm] Failed to mark question as answered");
          }
        }

        setSignatureContext(null);
      }
    },
    [signatureContext, onFieldChange, answerQuestion]
  );

  const handleSignatureManagerClose = useCallback((open: boolean) => {
    setShowSignatureManager(open);
    if (!open) {
      setSignatureContext(null);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await saveFieldUpdates();
      toast.success("Progress saved");
    } catch {
      toast.error("Failed to save");
    }
  }, [saveFieldUpdates]);

  useEffect(() => {
    return () => {
      if (hasUnsavedChanges) {
        saveFieldUpdates().catch(console.error);
      }
    };
  }, [hasUnsavedChanges, saveFieldUpdates]);

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      if (hasUnsavedChanges) {
        await saveFieldUpdates();
      }

      const response = await fetch(`/api/documents/${documentId}/export`);
      if (!response.ok) {
        throw new Error("Export failed");
      }

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

  const isEarlyProcessing =
    !document ||
    document.status === "uploading" ||
    document.status === "analyzing" ||
    document.status === "refining" ||
    !document.fields_qc_complete;

  const getProcessingLabel = () => {
    if (!document) return "Loading document...";
    if (document.status === "uploading") return "Uploading document...";
    if (document.status === "analyzing") return "Analyzing with AI...";
    if (document.status === "extracting") return "Extracting form fields...";
    if (document.status === "refining" || !document.fields_qc_complete)
      return "Refining field detection...";
    if (progress?.phase === "displaying") return "Generating questions...";
    if (progress?.phase === "enhancing") return "Enhancing with AI...";
    return "Processing...";
  };

  if (loading && !document) {
    return (
      <>
        <AppHeader>
          <Skeleton className="h-6 w-48" />
        </AppHeader>
        <div className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </>
    );
  }

  if (error && !document) {
    return (
      <>
        <AppHeader>
          <h1 className="text-lg font-semibold">Error</h1>
        </AppHeader>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">
              {error || "Document not found"}
            </h2>
            <Link href="/dashboard">
              <Button variant="outline">
                <FolderOpen className="mr-2 h-4 w-4" />
                Back to Documents
              </Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (document?.status === "failed") {
    return (
      <>
        <AppHeader>
          <h1 className="text-lg font-semibold">Processing Failed</h1>
        </AppHeader>
        <div className="flex-1 flex items-center justify-center">
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
                Back to Documents
              </Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between min-w-0">
          <div className="min-w-0 mr-4">
            <h1 className="font-semibold truncate">
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
          <div className="flex items-center gap-2 shrink-0">
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
      </AppHeader>
      <div className="px-4">
        <Progress
          value={isEarlyProcessing ? 0 : completionStats.percentage}
          className="h-2"
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          orientation={isMobile ? "vertical" : "horizontal"}
          className="h-full"
        >
          <ResizablePanel
            defaultSize={isMobile ? 50 : 65}
            minSize={isMobile ? 30 : 40}
          >
            <div
              className={`h-full relative ${isMobile ? "border-b" : "border-r"}`}
            >
              <div
                className={`h-full ${isEarlyProcessing ? "blur-sm pointer-events-none" : ""}`}
              >
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

              {isEarlyProcessing && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
                  <div className="text-center space-y-4 p-8 rounded-xl bg-card border shadow-lg max-w-md">
                    <div className="flex items-center justify-center gap-3">
                      <Sparkles className="h-8 w-8 text-primary animate-pulse" />
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">
                        {getProcessingLabel()}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        This usually takes 10-30 seconds
                      </p>
                    </div>
                    {progress && progress.pagesTotal > 0 && (
                      <div className="space-y-2">
                        <Progress
                          value={
                            (progress.pagesComplete / progress.pagesTotal) * 100
                          }
                          className="h-2"
                        />
                        <p className="text-xs text-muted-foreground">
                          {progress.pagesComplete} / {progress.pagesTotal} pages
                          processed
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={isMobile ? 50 : 35}
            minSize={isMobile ? 30 : 25}
          >
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
              onOpenSignatureManager={handleOpenSignatureManager}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <SignatureManager
        open={showSignatureManager}
        onOpenChange={handleSignatureManagerClose}
        onInsert={signatureContext ? handleSignatureInsert : undefined}
        initialTab={signatureContext?.type || "signature"}
      />
    </>
  );
}
