"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { Check, Loader2, ChevronRight, PenLine } from "lucide-react";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { toast } from "sonner";
import type { QuestionGroup, SignatureType } from "@/lib/types";

interface QuestionCardProps {
  question: QuestionGroup;
  isActive: boolean;
  onAnswer: (answer: string) => Promise<void>;
  isAnswering: boolean;
  onClick?: () => void;
  onOpenSignatureManager?: (fieldIds: string[], type: SignatureType, questionId?: string) => void;
}

export function QuestionCard({
  question,
  isActive,
  onAnswer,
  isAnswering,
  onClick,
  onOpenSignatureManager,
}: QuestionCardProps) {
  const [answer, setAnswer] = useState(question.answer || "");

  // Voice recording for text input types
  const supportsVoice = ["text", "textarea"].includes(question.input_type);
  const { state: voiceState, toggleRecording } = useVoiceRecording({
    onTranscription: (text) => {
      if (text.trim()) {
        setAnswer((prev) => (prev ? `${prev} ${text}` : text));
      }
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    await onAnswer(answer);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && question.input_type !== "textarea") {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-submit when signature/initials is drawn (when answer is set via SignatureManager)
  useEffect(() => {
    const isSignatureType = question.input_type === "signature" || question.input_type === "initials";
    if (isSignatureType && answer && answer.startsWith("data:image") && question.status !== "answered") {
      onAnswer(answer);
    }
  }, [answer, question.input_type, question.status, onAnswer]);

  if (question.status === "answered") {
    const isSignatureOrInitials =
      (question.input_type === "signature" || question.input_type === "initials") &&
      question.answer?.startsWith("data:image");

    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-2.5 h-2.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground line-through">
                {question.question}
              </p>
              {isSignatureOrInitials ? (
                <div className="mt-1 bg-white rounded border p-1 inline-block">
                  <Image
                    src={question.answer || ""}
                    alt={question.input_type === "signature" ? "Signature" : "Initials"}
                    width={120}
                    height={40}
                    className="object-contain"
                  />
                </div>
              ) : (
                <p className="text-sm font-medium mt-0.5 truncate">
                  {question.answer}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (question.status === "hidden") {
    return null;
  }

  const renderInput = () => {
    switch (question.input_type) {
      case "textarea":
        return (
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer..."
            rows={3}
            className="resize-none"
            disabled={isAnswering}
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={question.id}
              checked={answer === "true" || answer === "yes"}
              onCheckedChange={(checked) =>
                setAnswer(checked ? "yes" : "no")
              }
              disabled={isAnswering}
            />
            <Label htmlFor={question.id} className="text-sm cursor-pointer">
              Yes
            </Label>
          </div>
        );

      case "date":
        return (
          <Input
            type="date"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isAnswering}
          />
        );

      case "signature":
      case "initials": {
        const sigType = question.input_type as SignatureType;
        const label = sigType === "signature" ? "signature" : "initials";
        const hasValue = answer && answer.startsWith("data:image");

        return (
          <div
            className={`relative border-2 border-dashed rounded-lg bg-muted/30 transition-colors ${
              isAnswering ? "opacity-50" : "cursor-pointer hover:bg-muted/50 hover:border-primary/50"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isAnswering && onOpenSignatureManager) {
                onOpenSignatureManager(question.field_ids, sigType, question.id);
              }
            }}
          >
            {hasValue ? (
              // Show signature preview
              <div className="aspect-[3/1] relative bg-white rounded">
                <Image
                  src={answer}
                  alt={sigType === "signature" ? "Your signature" : "Your initials"}
                  fill
                  className="object-contain p-2"
                />
              </div>
            ) : (
              // Empty state
              <div className="aspect-[3/1] flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <PenLine className="h-6 w-6" />
                <span className="text-sm">
                  Tap to {hasValue ? "change" : "add"} {label}
                </span>
              </div>
            )}
          </div>
        );
      }

      default:
        return (
          <Input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            disabled={isAnswering}
            autoFocus={isActive}
          />
        );
    }
  };

  return (
    <Card
      className={`transition-all cursor-pointer ${
        isActive
          ? "ring-2 ring-primary shadow-md"
          : "hover:shadow-sm hover:ring-1 hover:ring-muted-foreground/20"
      }`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="space-y-2">
          {question.profile_key && (
            <div className="flex justify-end">
              <Badge variant="outline" className="text-xs">
                {question.profile_key}
              </Badge>
            </div>
          )}

          <p className="font-medium text-sm">{question.question}</p>

          {question.input_type === "signature" || question.input_type === "initials" ? (
            <div>{renderInput()}</div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1">{renderInput()}</div>
              {supportsVoice && (
                <MicrophoneButton
                  state={voiceState}
                  onClick={toggleRecording}
                  size="sm"
                  disabled={isAnswering}
                />
              )}
              <Button
                onClick={handleSubmit}
                disabled={!answer.trim() || isAnswering}
                size="icon"
                className="flex-shrink-0 h-9 w-9"
              >
                {isAnswering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {question.field_ids.length > 1 && (
            <p className="text-xs text-muted-foreground">
              This will fill {question.field_ids.length} related fields
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
