"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import {
  Drawer,
  DrawerContentTransparent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Download, Loader2, Sparkles, FolderOpen, MessageSquare, Cloud, Brain, Check } from "lucide-react";
import { toast } from "sonner";
import { PDFWithKonva } from "./PDFWithKonva";
import { QuestionsPanel } from "./QuestionsPanel";
import { SignatureManager } from "@/components/signature";
import { AppHeader } from "@/components/layout";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useQuestions } from "@/hooks/useQuestions";
import { useFieldSync } from "@/hooks/useFieldSync";
import { usePageImageUpload } from "@/hooks/usePageImageUpload";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { NormalizedCoordinates, SignatureType, MemoryChoice } from "@/lib/types";
import { renderAllPageOverlaysKonva } from "@/lib/konva-export";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false); // Start minimized, auto-expand when questions arrive
  const [panelExpanded, setPanelExpanded] = useState(false); // false = 360px, true = 480px

  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureContext, setSignatureContext] = useState<{
    fieldIds: string[];
    type: SignatureType;
    questionId?: string;
  } | null>(null);

  // Context input state
  const [contextText, setContextText] = useState("");
  const [contextSubmitting, setContextSubmitting] = useState(false);
  const [tailoredQuestion, setTailoredQuestion] = useState<string | null>(null);
  const [useMemory, setUseMemory] = useState(true);
  const [showSubmittedConfirmation, setShowSubmittedConfirmation] = useState(false);
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

  // Generate a general prompt based on filename
  const formName = document?.original_filename?.replace(/\.pdf$/i, "").replace(/[-_]/g, " ") || "form";
  const generalPrompt = `This is a ${formName}. Share any relevant details that might help fill it out — names, dates, addresses, or other information you'll need to provide.`;

  // Voice recording for context input
  const { state: voiceState, toggleRecording } = useVoiceRecording({
    onTranscription: (text) => {
      if (text.trim()) {
        setContextText((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
    onError: (error) => {
      console.error("[AutoForm] Voice recording error:", error);
    },
    documentId,
    questionText: tailoredQuestion || undefined,
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
  const handleContextSubmit = useCallback(async () => {
    setContextSubmitting(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: contextText.trim(), useMemory }),
      });
      if (!response.ok) throw new Error("Failed to submit context");

      setShowSubmittedConfirmation(true);
      setTimeout(() => setShowSubmittedConfirmation(false), 1500);
    } catch (error) {
      console.error("[AutoForm] Failed to submit context:", error);
    } finally {
      setContextSubmitting(false);
    }
  }, [documentId, contextText, useMemory]);

  // Context skip handler
  const handleContextSkip = useCallback(async () => {
    setContextSubmitting(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "", skip: true, useMemory }),
      });
      if (!response.ok) throw new Error("Failed to skip context");

      setShowSubmittedConfirmation(true);
      setTimeout(() => setShowSubmittedConfirmation(false), 1500);
    } catch (error) {
      console.error("[AutoForm] Failed to skip context:", error);
    } finally {
      setContextSubmitting(false);
    }
  }, [documentId, useMemory]);

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
        // Navigate to the question's page
        if (question.page_number !== currentPage) {
          setCurrentPage(question.page_number);
        }

        // Set active field and trigger scroll (if question has fields)
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
          // AI wasn't confident - fields not updated
          toast.warning(result.warning, { duration: 5000 });
        } else if (result?.partial) {
          // Partial fill - some fields were filled, question updated for remaining
          const filledList = result.filledFields?.join(", ") || "some fields";
          toast.success(`Saved ${filledList}. Please provide the remaining info.`, {
            duration: 4000,
          });
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

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      if (hasUnsavedChanges) {
        await saveFieldUpdates();
      }

      // Get PDF page dimensions
      const dimResponse = await fetch(`/api/documents/${documentId}/dimensions`);
      if (!dimResponse.ok) {
        throw new Error("Failed to get PDF dimensions");
      }
      const { dimensions } = await dimResponse.json();

      if (!dimensions || dimensions.length === 0) {
        throw new Error("No page dimensions found");
      }

      // Render overlays for all pages using Konva (WYSIWYG)
      // Use dimensions.length (actual PDF page count) - document.page_count can be stale
      const firstPage = dimensions[0];
      const overlays = await renderAllPageOverlaysKonva(
        fields,
        fieldValues,
        dimensions.length,
        firstPage.width,
        firstPage.height
      );

      // Send overlays to server for merging with PDF
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

  // Block PDF viewer until we have fields to show
  // User sees context question while PDF is blocked
  // Once fields arrive (via real-time), PDF reveals progressively
  const hasFields = fields.length > 0;
  const isEarlyProcessing =
    !document ||
    document.status === "uploading" ||
    document.status === "analyzing" ||
    !hasFields; // Block until we have fields

  // Show extraction indicator if extracting but not blocking
  const isExtracting =
    document?.status === "extracting" ||
    (document?.status !== "ready" && !document?.fields_qc_complete);

  const getProcessingLabel = () => {
    if (document?.status === "uploading") return "Uploading Document";
    return "Analyzing Document";
  };

  if (loading && !document) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <AppHeader>
          <Skeleton className="h-6 w-48" />
        </AppHeader>
        <div className="flex-1 p-4 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
            <Skeleton className="h-full min-h-[400px]" />
            <Skeleton className="h-full min-h-[400px]" />
          </div>
        </div>
      </div>
    );
  }

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
            <h1 className="font-semibold truncate">
              {document?.original_filename || "Loading..."}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Subtle autosave indicator */}
            {saving && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs hidden sm:inline">Saving...</span>
              </div>
            )}
            {!saving && !hasUnsavedChanges && completionStats.filled > 0 && (
              <span title="All changes saved">
                <Cloud className="h-4 w-4 text-muted-foreground/50" />
              </span>
            )}
            <Button
              size={isMobile ? "sm" : "default"}
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
            {!isMobile && (
              <Button
                variant={panelOpen ? "secondary" : "outline"}
                size="default"
                onClick={() => setPanelOpen(!panelOpen)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Assistant
              </Button>
            )}
          </div>
        </div>
      </AppHeader>

      <div className="flex-1 overflow-hidden">
        {isMobile ? (
          /* Mobile: Full PDF with Drawer */
          <div className="h-full relative">
            {/* PDF Viewer - Full height on mobile */}
            <div className={`h-full relative overflow-hidden ${isEarlyProcessing ? "pointer-events-none" : ""}`}>
              {pdfUrl ? (
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
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Skeleton className="h-[600px] w-full max-w-[600px]" />
                </div>
              )}

              {/* Processing Overlay */}
              {isEarlyProcessing && (
                <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto py-4">
                  <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
                  <div className="relative space-y-4 p-6 rounded-xl bg-card border shadow-lg max-w-sm w-full mx-4 my-auto">
                    {/* Loading indicator */}
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-3 mb-2">
                        <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                      <h3 className="text-base font-semibold">{getProcessingLabel()}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        This usually takes 10-30 seconds
                      </p>
                    </div>

                    {/* Context Input Section */}
                    {document && !document.context_submitted && !showSubmittedConfirmation && (
                      <div className="space-y-3 pt-3 border-t">
                        <div className="relative p-[2px] rounded-xl overflow-hidden">
                          <div
                            className="absolute inset-0 rounded-xl"
                            style={{
                              background: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #5f27cd, #ff6b6b)",
                              backgroundSize: "400% 100%",
                              animation: "shimmer 8s linear infinite",
                            }}
                          />
                          <div className="relative p-3 rounded-[10px] bg-white dark:bg-gray-900">
                            <p className="font-bold text-gray-900 dark:text-gray-100 mb-1 text-sm">
                              Share some context to give us a head start
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-300">
                              {tailoredQuestion || generalPrompt}
                            </p>
                          </div>
                        </div>

                        <div className="relative">
                          <Textarea
                            value={contextText}
                            onChange={(e) => setContextText(e.target.value)}
                            placeholder="Type or speak your answer..."
                            rows={3}
                            className="resize-none pr-12 text-sm"
                            disabled={contextSubmitting}
                          />
                          <div className="absolute bottom-2 right-2">
                            <MicrophoneButton
                              state={voiceState}
                              onClick={toggleRecording}
                              size="sm"
                              disabled={contextSubmitting}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
                            <Label htmlFor="use-memory-mobile" className="text-xs cursor-pointer">
                              Use saved memories
                            </Label>
                          </div>
                          <Switch
                            id="use-memory-mobile"
                            checked={useMemory}
                            onCheckedChange={setUseMemory}
                            disabled={contextSubmitting}
                          />
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={handleContextSubmit}
                            disabled={contextSubmitting || !contextText.trim()}
                            className="flex-1"
                            size="default"
                          >
                            {contextSubmitting ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            Continue
                          </Button>
                          <Button
                            onClick={handleContextSkip}
                            disabled={contextSubmitting}
                            variant="outline"
                            size="default"
                          >
                            Skip
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Submitted Confirmation */}
                    {showSubmittedConfirmation && (
                      <div className="flex items-center justify-center gap-2 py-3 text-green-600 dark:text-green-400">
                        <Check className="h-5 w-5" />
                        <span className="font-medium">Submitted</span>
                      </div>
                    )}

                    {/* Progress bar */}
                    {progress && progress.pagesTotal > 0 && (
                      <div className="space-y-2 pt-3 border-t">
                        <Progress value={(progress.pagesComplete / progress.pagesTotal) * 100} className="h-2" />
                        <p className="text-xs text-muted-foreground text-center">
                          {progress.pagesComplete} / {progress.pagesTotal} pages processed
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Drawer Trigger - Fixed at bottom */}
            <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DrawerTrigger asChild>
                <Button
                  className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 shadow-lg gap-2 px-6"
                  size="lg"
                  disabled={isEarlyProcessing}
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
          </div>
        ) : (
          /* Desktop: PDF viewer only (panel is outside this column) */
          <div className="h-full relative overflow-hidden">
            <div className={isEarlyProcessing ? "pointer-events-none h-full" : "h-full"}>
              {pdfUrl ? (
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
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Skeleton className="h-[600px] w-full max-w-[600px]" />
                </div>
              )}
            </div>

            {/* Processing Overlay */}
            {isEarlyProcessing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
                <div className="relative space-y-6 p-8 rounded-xl bg-card border shadow-lg max-w-lg w-full mx-4">
                  {/* Loading indicator */}
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-3 mb-2">
                      <Sparkles className="h-8 w-8 text-primary animate-pulse" />
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold">{getProcessingLabel()}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      This usually takes 10-30 seconds
                    </p>
                  </div>

                  {/* Context Input Section */}
                  {document && !document.context_submitted && !showSubmittedConfirmation && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="relative p-[2px] rounded-xl overflow-hidden">
                        <div
                          className="absolute inset-0 rounded-xl"
                          style={{
                            background: "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #5f27cd, #ff6b6b)",
                            backgroundSize: "400% 100%",
                            animation: "shimmer 8s linear infinite",
                          }}
                        />
                        <div className="relative p-4 rounded-[10px] bg-white dark:bg-gray-900">
                          <p className="font-bold text-gray-900 dark:text-gray-100 mb-2">
                            Share some context to give us a head start
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-300">
                            {tailoredQuestion || generalPrompt}
                          </p>
                        </div>
                      </div>

                      <div className="relative">
                        <Textarea
                          value={contextText}
                          onChange={(e) => setContextText(e.target.value)}
                          placeholder="Type or speak your answer..."
                          rows={4}
                          className="resize-none pr-14"
                          disabled={contextSubmitting}
                        />
                        <div className="absolute bottom-2 right-2">
                          <MicrophoneButton
                            state={voiceState}
                            onClick={toggleRecording}
                            size="lg"
                            disabled={contextSubmitting}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="use-memory-overlay" className="text-sm cursor-pointer">
                            Use saved memories for auto-fill
                          </Label>
                        </div>
                        <Switch
                          id="use-memory-overlay"
                          checked={useMemory}
                          onCheckedChange={setUseMemory}
                          disabled={contextSubmitting}
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={handleContextSubmit}
                          disabled={contextSubmitting || !contextText.trim()}
                          className="flex-1"
                          size="lg"
                        >
                          {contextSubmitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                          )}
                          Continue
                        </Button>
                        <Button
                          onClick={handleContextSkip}
                          disabled={contextSubmitting}
                          variant="outline"
                          size="lg"
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Submitted Confirmation */}
                  {showSubmittedConfirmation && (
                    <div className="flex items-center justify-center gap-2 py-4 text-green-600 dark:text-green-400">
                      <Check className="h-5 w-5" />
                      <span className="font-medium">Submitted</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  {progress && progress.pagesTotal > 0 && (
                    <div className="space-y-2 pt-4 border-t">
                      <Progress value={(progress.pagesComplete / progress.pagesTotal) * 100} className="h-2" />
                      <p className="text-xs text-muted-foreground text-center">
                        {progress.pagesComplete} / {progress.pagesTotal} pages processed
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Questions Panel - full height, outside left column, always mounted for smooth animation */}
      {!isMobile && (
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
