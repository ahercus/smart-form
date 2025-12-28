"use client";

import { useState, useRef, useCallback } from "react";

export type RecordingState = "idle" | "recording" | "processing";

interface UseVoiceRecordingOptions {
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
  documentId?: string; // Optional document context for better transcription
  questionText?: string; // The current question being answered
  fieldIds?: string[]; // Field IDs linked to this question (for fetching labels)
}

export function useVoiceRecording({
  onTranscription,
  onError,
  documentId,
  questionText,
  fieldIds,
}: UseVoiceRecordingOptions) {
  const [state, setState] = useState<RecordingState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Use webm format which is widely supported
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        stream.getTracks().forEach((track) => track.stop());

        if (chunksRef.current.length === 0) {
          setState("idle");
          return;
        }

        setState("processing");

        try {
          const audioBlob = new Blob(chunksRef.current, { type: mimeType });
          const base64Audio = await blobToBase64(audioBlob);

          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: base64Audio,
              mimeType,
              documentId,
              questionText,
              fieldIds,
            }),
          });

          if (!response.ok) {
            throw new Error("Transcription failed");
          }

          const { text } = await response.json();
          onTranscription(text);
        } catch (error) {
          console.error("[AutoForm] Transcription error:", error);
          onError?.(error instanceof Error ? error.message : "Transcription failed");
        } finally {
          setState("idle");
        }
      };

      mediaRecorder.start();
      setState("recording");
    } catch (error) {
      console.error("[AutoForm] Failed to start recording:", error);
      onError?.("Could not access microphone. Please check permissions.");
      setState("idle");
    }
  }, [onTranscription, onError, documentId, questionText, fieldIds]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const toggleRecording = useCallback(() => {
    if (state === "idle") {
      startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
    // If processing, do nothing
  }, [state, startRecording, stopRecording]);

  return {
    state,
    isRecording: state === "recording",
    isProcessing: state === "processing",
    toggleRecording,
    startRecording,
    stopRecording,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
