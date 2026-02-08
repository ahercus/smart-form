"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, Camera, Loader2, Brain, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export type SetupCardState = "upload" | "context" | "analyzing";

interface SetupCardProps {
  state: SetupCardState;
  onFileSelect: (file: File) => void;
  onContextSubmit: (context: string, useMemory: boolean) => void;
  onContextSkip: (useMemory: boolean) => void;
  progress?: { current: number; total: number; label?: string };
  tailoredQuestion?: string | null;
  documentId?: string;
  uploading?: boolean;
}

export function SetupCard({
  state,
  onFileSelect,
  onContextSubmit,
  onContextSkip,
  progress,
  tailoredQuestion,
  documentId,
  uploading = false,
}: SetupCardProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [contextText, setContextText] = useState("");
  const [useMemory, setUseMemory] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

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

  // Generic prompt when tailored question isn't ready yet
  const genericPrompt =
    "Share any relevant details - names, dates, addresses, or other information you'll need for this form.";

  const handleDrag = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (state !== "upload" || uploading) return;

      if (e.type === "dragenter" || e.type === "dragover") {
        setDragActive(true);
      } else if (e.type === "dragleave") {
        setDragActive(false);
      }
    },
    [state, uploading]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (state !== "upload" || uploading) return;

      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        if (!ACCEPTED_TYPES.includes(droppedFile.type)) {
          toast.error("Please upload a PDF or image file");
          return;
        }
        onFileSelect(droppedFile);
      }
    },
    [state, uploading, onFileSelect]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
          toast.error("Please upload a PDF or image file");
          return;
        }
        onFileSelect(selectedFile);
      }
    },
    [onFileSelect]
  );

  const handleContextSubmitClick = useCallback(async () => {
    setSubmitting(true);
    try {
      await onContextSubmit(contextText.trim(), useMemory);
    } finally {
      setSubmitting(false);
    }
  }, [contextText, useMemory, onContextSubmit]);

  const handleContextSkipClick = useCallback(async () => {
    setSubmitting(true);
    try {
      await onContextSkip(useMemory);
    } finally {
      setSubmitting(false);
    }
  }, [useMemory, onContextSkip]);

  // Upload State
  if (state === "upload") {
    return (
      <div className="w-full max-w-md space-y-6">
        {/* Header with app name and description */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold">AutoForm AI</h1>
          </div>
          <p className="text-muted-foreground">
            Scan your document and let AI identify where you need to sign or type.
          </p>
        </div>

        {/* Card container */}
        <div className="p-6 rounded-xl bg-card border shadow-lg space-y-4">
          {/* Dashed border upload area */}
          <div
          className={cn(
            "relative rounded-xl border-2 border-dashed transition-all cursor-pointer",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center justify-center py-10 px-6">
            <div
              className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-colors",
                dragActive ? "bg-primary/20" : "bg-muted"
              )}
            >
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              ) : (
                <Upload
                  className={cn(
                    "h-7 w-7 transition-colors",
                    dragActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
              )}
            </div>

            <h2 className="text-lg font-semibold mb-1">
              {uploading
                ? "Uploading..."
                : dragActive
                  ? "Drop to upload"
                  : "Drop your form here"}
            </h2>
            <p className="text-sm text-muted-foreground text-center">
              {uploading ? "Starting AI analysis..." : "We'll help you fill it out with AI"}
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          </div>
        </div>

        {/* Camera button - mobile only, outside the card */}
        {isMobile && !uploading && (
          <>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              size="lg"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                cameraInputRef.current?.click();
              }}
            >
              <Camera className="h-5 w-5 mr-2" />
              Take a Picture
            </Button>
          </>
        )}
      </div>
    );
  }

  // Context Input State
  if (state === "context") {
    return (
      <div className="w-full max-w-md p-6 rounded-xl bg-card border shadow-lg space-y-4">
        {/* Rainbow shimmer border box */}
        <div className="relative p-[2px] rounded-xl overflow-hidden">
          <div
            className="absolute inset-0 rounded-xl"
            style={{
              background:
                "linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #5f27cd, #ff6b6b)",
              backgroundSize: "400% 100%",
              animation: "shimmer 8s linear infinite",
            }}
          />
          <div className="relative p-4 rounded-[10px] bg-white dark:bg-gray-900">
            <p className="font-bold text-gray-900 dark:text-gray-100 mb-2">
              Share some context to give us a head start
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {tailoredQuestion || genericPrompt}
            </p>
          </div>
        </div>

        {/* Textarea with mic button */}
        <div className="relative">
          <Textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            placeholder="Type or speak your answer..."
            rows={4}
            className="resize-none pr-14"
            disabled={submitting}
          />
          <div className="absolute bottom-2 right-2">
            <MicrophoneButton
              state={voiceState}
              onClick={toggleRecording}
              size="lg"
              disabled={submitting}
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

        {/* Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleContextSubmitClick}
            disabled={submitting || !contextText.trim()}
            className="flex-1"
            size="lg"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
          <Button
            onClick={handleContextSkipClick}
            disabled={submitting}
            variant="outline"
            size="lg"
          >
            Skip
          </Button>
        </div>

        {/* Progress bar */}
        {progress && progress.total > 0 && (
          <div className="space-y-2 pt-2">
            <Progress
              value={(progress.current / progress.total) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground text-center">
              {progress.label || `${progress.current} / ${progress.total} pages`}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Analyzing State
  if (state === "analyzing") {
    return (
      <div className="w-full max-w-md p-6 rounded-xl bg-card border shadow-lg space-y-4">
        <div className="text-center">
          <div className="flex items-center justify-center mb-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Analyzing document...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Mapping fields and preparing questions
          </p>
        </div>

        {/* Progress bar */}
        {progress && progress.total > 0 && (
          <div className="space-y-2">
            <Progress
              value={(progress.current / progress.total) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground text-center">
              {progress.label ||
                `Mapping fields on page ${progress.current} of ${progress.total}`}
            </p>
          </div>
        )}
      </div>
    );
  }

  return null;
}
