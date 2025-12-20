"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles } from "lucide-react";
import type { ProcessingProgress } from "@/lib/types";

interface ProcessingOverlayProps {
  progress: ProcessingProgress | null;
}

export function ProcessingOverlay({ progress }: ProcessingOverlayProps) {
  if (!progress || progress.phase === "ready") {
    return null;
  }

  const phaseLabels: Record<string, string> = {
    idle: "Preparing...",
    parsing: "Analyzing document...",
    displaying: "Loading fields...",
    enhancing: "Enhancing with AI...",
    failed: "Processing failed",
  };

  const label = phaseLabels[progress.phase] || "Processing...";
  const percentage =
    progress.pagesTotal > 0
      ? (progress.pagesComplete / progress.pagesTotal) * 100
      : 0;

  // Show minimal UI during enhancing phase (user can still work)
  if (progress.phase === "enhancing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
        <Sparkles className="h-4 w-4 animate-pulse text-amber-500" />
        <span>Enhancing fields...</span>
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          {progress.pagesTotal > 0 && (
            <span className="text-muted-foreground">
              {progress.pagesComplete} / {progress.pagesTotal} pages
            </span>
          )}
        </div>
        <Progress value={percentage} className="h-2" />
      </div>

      {progress.questionsDelivered > 0 && (
        <p className="text-sm text-muted-foreground">
          {progress.questionsDelivered} questions generated
        </p>
      )}

      {progress.phase === "failed" && progress.error && (
        <p className="text-sm text-destructive">{progress.error}</p>
      )}

      {/* Skeleton questions during parsing/displaying */}
      {(progress.phase === "parsing" || progress.phase === "displaying") && (
        <div className="space-y-3 mt-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-3/4" />
        </div>
      )}
    </div>
  );
}

/**
 * Minimal enhancing indicator for use in other components
 */
export function EnhancingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <Sparkles className="h-3 w-3 animate-pulse" />
      <span>Enhancing</span>
    </div>
  );
}
