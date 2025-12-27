"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { Sparkles, Loader2, ChevronRight, Lightbulb, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { ProcessingProgress, Document } from "@/lib/types";

interface ContextInputPanelProps {
  documentId: string;
  document: Document | null;
  progress: ProcessingProgress | null;
  onContextSubmitted?: () => void;
}

export function ContextInputPanel({
  documentId,
  document,
  progress,
  onContextSubmitted,
}: ContextInputPanelProps) {
  const fieldsReady = document?.fields_qc_complete ?? false;
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tailoredQuestion, setTailoredQuestion] = useState<string | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);

  // Voice recording
  const { state: voiceState, toggleRecording } = useVoiceRecording({
    onTranscription: (text) => {
      if (text.trim()) {
        setContext((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  // Fetch tailored context question on mount
  useEffect(() => {
    let cancelled = false;

    const fetchTailoredQuestion = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/analyze-context`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          setTailoredQuestion(data.question);
        }
      } catch (error) {
        console.error("[AutoForm] Failed to fetch tailored question:", error);
      } finally {
        if (!cancelled) {
          setLoadingQuestion(false);
        }
      }
    };

    fetchTailoredQuestion();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleSubmit = async () => {
    setSubmitting(true);

    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: context.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit context");
      }

      toast.success("Context submitted! Generating questions...");
      onContextSubmitted?.();
    } catch (error) {
      console.error("[AutoForm] Failed to submit context:", error);
      toast.error("Failed to submit context");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setSubmitting(true);

    try {
      const response = await fetch(`/api/documents/${documentId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "", skip: true }),
      });

      if (!response.ok) {
        throw new Error("Failed to skip context");
      }

      toast.success("Generating questions...");
      onContextSubmitted?.();
    } catch (error) {
      console.error("[AutoForm] Failed to skip context:", error);
      toast.error("Failed to continue");
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate progress percentage
  const progressPercent = progress?.pagesTotal
    ? Math.round((progress.pagesComplete / progress.pagesTotal) * 100)
    : 0;

  const getPhaseLabel = () => {
    if (!progress) return "Starting...";
    switch (progress.phase) {
      case "parsing":
        return "Extracting form fields...";
      case "displaying":
        return "Analyzing with AI...";
      case "enhancing":
        return "Refining field detection...";
      default:
        return "Processing...";
    }
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">AI Assistant</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Add context while we analyze your form
        </p>
      </div>

      {/* Processing Status */}
      <div className={`px-4 py-3 border-b ${fieldsReady ? "bg-green-50 dark:bg-green-950/30" : "bg-muted/30"}`}>
        {fieldsReady ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              Fields detected and ready!
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{getPhaseLabel()}</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
            {progress?.pagesTotal ? (
              <p className="text-xs text-muted-foreground mt-1">
                {progress.pagesComplete} of {progress.pagesTotal} pages
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Context Input */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <Lightbulb className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-primary mb-1">Help us help you</p>
              {loadingQuestion ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Analyzing document...</span>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {tailoredQuestion || "Share any context about this form that would help us fill it out accurately."}
                </p>
              )}
            </div>
          </div>

          <div className="relative">
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={loadingQuestion ? "Loading..." : "Type or speak your answer..."}
              rows={6}
              className="resize-none pr-14"
              disabled={submitting || loadingQuestion}
            />
            <div className="absolute bottom-2 right-2">
              <MicrophoneButton
                state={voiceState}
                onClick={toggleRecording}
                size="lg"
                disabled={submitting || loadingQuestion}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleSubmit}
              disabled={submitting || !context.trim()}
              className={`w-full ${fieldsReady ? "bg-green-600 hover:bg-green-700" : ""}`}
              size="lg"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : fieldsReady ? (
                <Sparkles className="mr-2 h-4 w-4" />
              ) : (
                <ChevronRight className="mr-2 h-4 w-4" />
              )}
              {submitting
                ? "Generating questions..."
                : fieldsReady
                  ? "Continue to Questions"
                  : "Submit & Generate Questions"}
            </Button>

            <Button
              onClick={handleSkip}
              disabled={submitting}
              variant="ghost"
              className="w-full"
              size="sm"
            >
              {fieldsReady ? "Skip context" : "Skip for now"}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            You can always add more context later
          </p>
        </div>
      </div>
    </div>
  );
}
