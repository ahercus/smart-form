"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, ChevronRight, CheckCircle2, Brain } from "lucide-react";
import { toast } from "sonner";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { Document } from "@/lib/types";

interface ContextInputPanelProps {
  documentId: string;
  document: Document | null;
  onContextSubmitted?: () => void;
}

export function ContextInputPanel({
  documentId,
  document,
  onContextSubmitted,
}: ContextInputPanelProps) {
  const fieldsReady = document?.fields_qc_complete ?? false;
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tailoredQuestion, setTailoredQuestion] = useState<string | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [useMemory, setUseMemory] = useState(true); // Memory ON by default

  // Voice recording - passes documentId and tailored question for context-aware transcription
  const { state: voiceState, toggleRecording } = useVoiceRecording({
    onTranscription: (text) => {
      if (text.trim()) {
        setContext((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
    onError: (error) => {
      toast.error(error);
    },
    documentId,
    questionText: tailoredQuestion || undefined,
  });

  // Fetch tailored context question - retry if page images not ready
  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds between retries

    const fetchTailoredQuestion = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/analyze-context`);
        if (response.ok && !cancelled) {
          const data = await response.json();

          // If we got a fallback (no page image yet), retry after delay
          if (data.fallback && retryCount < maxRetries) {
            retryCount++;
            setTimeout(fetchTailoredQuestion, retryDelay);
            return;
          }

          setTailoredQuestion(data.question);
          setLoadingQuestion(false);
        }
      } catch (error) {
        console.error("[AutoForm] Failed to fetch tailored question:", error);
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
        body: JSON.stringify({ context: context.trim(), useMemory }),
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
        body: JSON.stringify({ context: "", skip: true, useMemory }),
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

      {/* Processing Status - only show when fields are ready */}
      {fieldsReady && (
        <div className="px-4 py-3 border-b bg-green-50 dark:bg-green-950/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              Fields detected and ready!
            </span>
          </div>
        </div>
      )}

      {/* Context Input */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-4">
          <div className="relative p-[2px] rounded-xl overflow-hidden">
            {/* Animated gradient border */}
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
                Share some broad context to get started...
              </p>
              <div className="text-sm">
                {loadingQuestion ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : (
                  <p className="text-gray-600 dark:text-gray-300">
                    {tailoredQuestion || "Share any context about this form that would help us fill it out accurately."}
                  </p>
                )}
              </div>
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

          {/* Memory toggle */}
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="use-memory" className="text-sm cursor-pointer">
                Use saved memories for auto-fill
              </Label>
            </div>
            <Switch
              id="use-memory"
              checked={useMemory}
              onCheckedChange={setUseMemory}
              disabled={submitting}
            />
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
