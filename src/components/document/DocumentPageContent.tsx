"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContentTransparent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Download, Loader2, FolderOpen, MessageSquare, ChevronLeft, ChevronRight, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PDFWithKonva } from "./PDFWithKonva";
import { QuestionsPanel } from "./QuestionsPanel";
import { SetupCard, SetupCardState } from "./SetupCard";
import { SignatureManager } from "@/components/signature";
import { AppHeader } from "@/components/layout";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useQuestions } from "@/hooks/useQuestions";
import { useFieldSync } from "@/hooks/useFieldSync";
import { usePageImageUpload } from "@/hooks/usePageImageUpload";
import type { NormalizedCoordinates, SignatureType, MemoryChoice } from "@/lib/types";
import { renderAllPageOverlaysKonva } from "@/lib/konva-export";
import { getClientDateTimePayload } from "@/lib/client-time";

interface DocumentPageContentProps {
  documentId: string;
}

export function DocumentPageContent({ documentId }: DocumentPageContentProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [scrollToQuestionId, setScrollToQuestionId] = useState<string | null>(null);
  const [scrollToFieldId, setScrollToFieldId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);

  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureContext, setSignatureContext] = useState<{
    fieldIds: string[];
    type: SignatureType;
    questionId?: string;
  } | null>(null);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Tailored question for context input
  const [tailoredQuestion, setTailoredQuestion] = useState<string | null>(null);
  const prevQuestionsLength = useRef(0);

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
    answerMemoryChoice,
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

  // Fetch tailored context question in background
  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 2000;

    const fetchTailoredQuestion = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/analyze-context`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          if (data.fallback && retryCount < maxRetries) {
            retryCount++;
            setTimeout(fetchTailoredQuestion, retryDelay);
            return;
          }
          setTailoredQuestion(data.question);
        }
      } catch (error) {
        console.error("[AutoForm] Failed to fetch tailored question:", error);
      }
    };

    fetchTailoredQuestion();
    return () => { cancelled = true; };
  }, [documentId]);

  // Auto-expand panel when questions first arrive
  useEffect(() => {
    if (prevQuestionsLength.current === 0 && questions.length > 0 && !panelOpen) {
      setPanelOpen(true);
    }
    prevQuestionsLength.current = questions.length;
  }, [questions.length, panelOpen]);

  // Context submit handler
  const handleContextSubmit = useCallback(async (context: string, useMemory: boolean) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          useMemory,
          ...getClientDateTimePayload(),
        }),
      });
      if (!response.ok) throw new Error("Failed to submit context");
    } catch (error) {
      console.error("[AutoForm] Failed to submit context:", error);
      toast.error("Failed to submit context");
      throw error;
    }
  }, [documentId]);

  // Context skip handler
  const handleContextSkip = useCallback(async (useMemory: boolean) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "",
          skip: true,
          useMemory,
          ...getClientDateTimePayload(),
        }),
      });
      if (!response.ok) throw new Error("Failed to skip context");
    } catch (error) {
      console.error("[AutoForm] Failed to skip context:", error);
      toast.error("Failed to skip context");
      throw error;
    }
  }, [documentId]);

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
    (fieldId: string | null) => {
      if (!fieldId) {
        setActiveFieldId(null);
        return;
      }

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

        console.log("[AutoForm] Field coordinates updated:", { fieldId, coords });
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
    async (pageNumber: number, coords: NormalizedCoordinates, fieldType?: string, initialValue?: string) => {
      try {
        const response = await fetch(`/api/documents/${documentId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageNumber,
            coordinates: coords,
            fieldType: fieldType || "text",
            value: initialValue,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to add field");
        }

        const { field } = await response.json();
        toast.success(fieldType === "signature" ? "Signature added" : fieldType === "initials" ? "Initials added" : "Field added");
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
        if (question.page_number !== currentPage) {
          setCurrentPage(question.page_number);
        }

        if (question.field_ids.length > 0) {
          const firstFieldId = question.field_ids[0];
          setActiveFieldId(firstFieldId);
          setScrollToFieldId(firstFieldId);
          setTimeout(() => setScrollToFieldId(null), 100);
        }

        goToQuestion(questionId);
      }
    },
    [questions, currentPage, goToQuestion]
  );

  const handleAnswerQuestion = useCallback(
    async (questionId: string, answer: string) => {
      try {
        const result = await answerQuestion(questionId, answer);
        if (result?.warning) {
          toast.warning(result.warning, { duration: 5000 });
        } else if (result?.partial) {
          const filledList = result.filledFields?.join(", ") || "some fields";
          toast.success(`Saved ${filledList}. Please provide the remaining info.`, { duration: 4000 });
        } else {
          toast.success("Answer saved");
        }
      } catch {
        toast.error("Failed to save answer");
      }
    },
    [answerQuestion]
  );

  const handleAnswerMemoryChoice = useCallback(
    async (questionId: string, choice: MemoryChoice) => {
      try {
        await answerMemoryChoice(questionId, choice);
        toast.success("Answer saved");
      } catch {
        toast.error("Failed to save answer");
      }
    },
    [answerMemoryChoice]
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

  const startRename = useCallback(() => {
    setRenameValue(document?.original_filename || "");
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [document?.original_filename]);

  const confirmRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === document?.original_filename) {
      setIsRenaming(false);
      return;
    }
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original_filename: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      toast.success("Document renamed");
    } catch {
      toast.error("Failed to rename document");
    }
    setIsRenaming(false);
  }, [renameValue, document?.original_filename, documentId]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
  }, []);

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      if (hasUnsavedChanges) {
        await saveFieldUpdates();
      }

      const dimResponse = await fetch(`/api/documents/${documentId}/dimensions`);
      if (!dimResponse.ok) {
        throw new Error("Failed to get PDF dimensions");
      }
      const { dimensions } = await dimResponse.json();

      if (!dimensions || dimensions.length === 0) {
        throw new Error("No page dimensions found");
      }

      const firstPage = dimensions[0];
      const overlays = await renderAllPageOverlaysKonva(
        fields,
        fieldValues,
        dimensions.length,
        firstPage.width,
        firstPage.height
      );

      const response = await fetch(`/api/documents/${documentId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlays }),
      });

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
  }, [documentId, document, fields, fieldValues, hasUnsavedChanges, saveFieldUpdates]);

  // Determine SetupCard state
  // Page 1 fields = fields on page 1 that have been mapped
  const page1Fields = fields.filter(f => f.page_number === 1);
  const hasPage1Fields = page1Fields.length > 0;
  const contextSubmitted = document?.context_submitted ?? false;

  // Setup card state machine:
  // - context: show context input (context not submitted yet)
  // - analyzing: context submitted, waiting for page 1 fields
  // - ready: page 1 fields arrived, document is editable
  const getSetupCardState = (): SetupCardState | "ready" | "loading" => {
    if (!document) return loading ? "loading" : "context";
    if (!contextSubmitted) return "context";
    if (!hasPage1Fields) return "analyzing";
    return "ready";
  };

  const setupCardState = getSetupCardState();
  const showSetupCard = setupCardState !== "ready" && setupCardState !== "loading";

  // Progress for SetupCard
  const setupProgress = progress
    ? { current: progress.pagesComplete, total: progress.pagesTotal }
    : undefined;

  if (error && !document) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
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
      </div>
    );
  }

  if (document?.status === "failed") {
    return (
      <div className="flex flex-col h-full overflow-hidden">
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
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left column: Header + Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppHeader>
          <div className="flex flex-1 items-center justify-between min-w-0">
            <div className="min-w-0 mr-4">
              {isRenaming ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    confirmRename();
                  }}
                >
                  <Input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={confirmRename}
                    className="h-8 text-sm font-semibold w-48"
                    autoFocus
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={!showSetupCard ? startRename : undefined}
                  className="group flex items-center gap-1.5 min-w-0"
                  disabled={showSetupCard}
                >
                  <h1 className="font-semibold truncate">
                    {showSetupCard ? "New Document" : (document?.original_filename || "Document")}
                  </h1>
                  {!showSetupCard && (
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Show controls only when document is ready */}
              {!showSetupCard && (
                <>
                  {/* Autosave indicator */}
                  {saving && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs hidden sm:inline">Saving...</span>
                    </div>
                  )}
                  <Button
                    size={isMobile ? "sm" : "default"}
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    {exporting ? "Exporting..." : "Export PDF"}
                  </Button>
                  {!isMobile && (
                    <Button
                      variant={panelOpen ? "secondary" : "outline"}
                      size="default"
                      onClick={() => setPanelOpen(!panelOpen)}
                    >
                      Assistant
                      {panelOpen ? (
                        <ChevronRight className="ml-2 h-4 w-4" />
                      ) : (
                        <ChevronLeft className="ml-2 h-4 w-4" />
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </AppHeader>

        <div className="flex-1 overflow-hidden relative">
          {/* Magical scanning line - on top of blur, during context input or analyzing */}
          {showSetupCard && (setupCardState === "context" || setupCardState === "analyzing") && (
            <div className="absolute inset-0 z-[15] overflow-hidden pointer-events-none">
              <div
                className="absolute left-0 right-0 h-1"
                style={{
                  background: "linear-gradient(90deg, transparent, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #5f27cd, transparent)",
                  boxShadow: "0 0 20px 10px rgba(72, 219, 251, 0.3), 0 0 40px 20px rgba(255, 159, 243, 0.2)",
                  animation: "scanLine 2.5s ease-in-out infinite",
                }}
              />
            </div>
          )}

          {/* PDF Viewer - always present, blurred when setup card visible */}
          <div className={`h-full ${showSetupCard ? "pointer-events-none" : ""}`}>
            {pdfUrl ? (
              <div className={`h-full transition-all duration-300 relative ${showSetupCard ? "blur-sm opacity-50" : ""}`}>
                <PDFWithKonva
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
                  isMobile={isMobile}
                />
              </div>
            ) : !showSetupCard ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Skeleton className="h-[600px] w-full max-w-[600px]" />
              </div>
            ) : null}
          </div>

          {/* Setup Card Overlay - z-20 to be above scan line (z-15) */}
          {showSetupCard && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <SetupCard
                state={setupCardState as SetupCardState}
                onFileSelect={() => {}}
                onContextSubmit={handleContextSubmit}
                onContextSkip={handleContextSkip}
                progress={setupProgress}
                tailoredQuestion={tailoredQuestion}
                documentId={documentId}
              />
            </div>
          )}

          {/* Mobile Drawer Trigger - only show when ready */}
          {isMobile && !showSetupCard && (
            <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DrawerTrigger asChild>
                <Button
                  className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 shadow-lg gap-2 px-6"
                  size="lg"
                >
                  <MessageSquare className="h-5 w-5" />
                  <span>
                    {completionStats.filled} / {completionStats.total} answered
                  </span>
                </Button>
              </DrawerTrigger>
              <DrawerContentTransparent>
                <DrawerTitle className="sr-only">Form Questions</DrawerTitle>
                <DrawerDescription className="sr-only">
                  Answer the form questions below
                </DrawerDescription>
                <QuestionsPanel
                  documentId={documentId}
                  document={document}
                  questions={questions}
                  progress={progress}
                  currentQuestionIndex={currentQuestionIndex}
                  currentPage={currentPage}
                  onAnswer={handleAnswerQuestion}
                  onAnswerMemoryChoice={handleAnswerMemoryChoice}
                  answering={answering}
                  onGoToQuestion={(questionId) => {
                    handleGoToQuestion(questionId);
                    setDrawerOpen(false);
                  }}
                  scrollToQuestionId={scrollToQuestionId}
                  onOpenSignatureManager={handleOpenSignatureManager}
                  loading={loading}
                />
              </DrawerContentTransparent>
            </Drawer>
          )}
        </div>
      </div>

      {/* Questions Panel - desktop only, only show when ready */}
      {!isMobile && !showSetupCard && (
        <div
          className={`h-full border-l bg-card flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-linear ${
            panelOpen
              ? panelExpanded
                ? "w-[480px]"
                : "w-[360px]"
              : "w-0 border-l-0"
          }`}
        >
          <div className={`h-full ${panelExpanded ? "w-[480px]" : "w-[360px]"}`}>
            <QuestionsPanel
              documentId={documentId}
              document={document}
              questions={questions}
              progress={progress}
              currentQuestionIndex={currentQuestionIndex}
              currentPage={currentPage}
              onAnswer={handleAnswerQuestion}
              onAnswerMemoryChoice={handleAnswerMemoryChoice}
              answering={answering}
              onGoToQuestion={handleGoToQuestion}
              scrollToQuestionId={scrollToQuestionId}
              onOpenSignatureManager={handleOpenSignatureManager}
              loading={loading}
              onClose={() => setPanelOpen(false)}
              expanded={panelExpanded}
              onToggleExpand={() => setPanelExpanded(!panelExpanded)}
            />
          </div>
        </div>
      )}

      <SignatureManager
        open={showSignatureManager}
        onOpenChange={handleSignatureManagerClose}
        onInsert={signatureContext ? handleSignatureInsert : undefined}
        initialTab={signatureContext?.type || "signature"}
      />
    </div>
  );
}
