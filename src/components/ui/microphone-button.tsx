"use client";

import { Mic, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecordingState } from "@/hooks/useVoiceRecording";

interface MicrophoneButtonProps {
  state: RecordingState;
  onClick: () => void;
  size?: "sm" | "lg";
  disabled?: boolean;
  className?: string;
}

export function MicrophoneButton({
  state,
  onClick,
  size = "sm",
  disabled = false,
  className,
}: MicrophoneButtonProps) {
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isDisabled = disabled || isProcessing;

  const sizeClasses = size === "lg"
    ? "h-12 w-12"
    : "h-9 w-9";

  const iconSize = size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <Button
      type="button"
      variant={isRecording ? "destructive" : "outline"}
      size="icon"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        sizeClasses,
        "relative flex-shrink-0 transition-all",
        isRecording && "animate-pulse",
        className
      )}
      title={
        isProcessing
          ? "Transcribing..."
          : isRecording
            ? "Stop recording"
            : "Start voice input"
      }
    >
      {isProcessing ? (
        <Loader2 className={cn(iconSize, "animate-spin")} />
      ) : isRecording ? (
        <Square className={cn(iconSize, "fill-current")} />
      ) : (
        <Mic className={iconSize} />
      )}

      {/* Recording indicator ring */}
      {isRecording && (
        <span className="absolute inset-0 rounded-md ring-2 ring-red-400 animate-ping opacity-75" />
      )}
    </Button>
  );
}
