"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { Check, Loader2, ChevronRight, PenLine, X, Pencil } from "lucide-react";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { toast } from "sonner";
import type { QuestionGroup, SignatureType, MemoryChoice } from "@/lib/types";

interface QuestionCardProps {
  question: QuestionGroup;
  isActive: boolean;
  onAnswer: (answer: string) => Promise<void>;
  onMemoryChoiceSelect?: (choice: MemoryChoice) => Promise<void>;
  isAnswering: boolean;
  onClick?: () => void;
  onOpenSignatureManager?: (fieldIds: string[], type: SignatureType, questionId?: string) => void;
  documentId?: string; // For context-aware transcription
}

export function QuestionCard({
  question,
  isActive,
  onAnswer,
  onMemoryChoiceSelect,
  isAnswering,
  onClick,
  onOpenSignatureManager,
  documentId,
}: QuestionCardProps) {
  const [answer, setAnswer] = useState(question.answer || "");
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editAnswer, setEditAnswer] = useState("");

  // Reset answer input when question changes (e.g., follow-up question after partial answer)
  // This clears the old answer when the question text is updated
  useEffect(() => {
    setAnswer(question.answer || "");
    setShowOtherInput(false);
  }, [question.question, question.answer]);

  // Voice recording for text input types - passes context for accurate transcription
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
    documentId,
    questionText: question.question,
    fieldIds: question.field_ids,
  });

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    await onAnswer(answer);
    // Memory extraction is now handled automatically in the API
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

    // Handle edit mode for answered questions
    const handleStartEdit = () => {
      setEditAnswer(question.answer || "");
      setIsEditing(true);
    };

    const handleCancelEdit = () => {
      setIsEditing(false);
      setEditAnswer("");
    };

    const handleSubmitEdit = async () => {
      if (!editAnswer.trim()) return;
      try {
        await onAnswer(editAnswer);
        setIsEditing(false);
        setEditAnswer("");
        toast.success("Answer updated");
      } catch {
        toast.error("Failed to update answer");
      }
    };

    const handleEditKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && question.input_type !== "textarea") {
        e.preventDefault();
        handleSubmitEdit();
      }
      if (e.key === "Escape") {
        handleCancelEdit();
      }
    };

    // Edit mode - show input with current answer
    if (isEditing) {
      return (
        <Card className="border-primary ring-2 ring-primary shadow-md">
          <CardContent className="px-2 py-1.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{question.question}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancelEdit}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex gap-2">
                {question.input_type === "textarea" ? (
                  <Textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    placeholder="Type your answer..."
                    rows={3}
                    className="resize-none"
                    disabled={isAnswering}
                    autoFocus
                  />
                ) : (
                  <Input
                    type={question.input_type === "date" ? "date" : "text"}
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    placeholder="Type your answer..."
                    disabled={isAnswering}
                    autoFocus
                  />
                )}
                <Button
                  onClick={handleSubmitEdit}
                  disabled={!editAnswer.trim() || isAnswering}
                  size="icon"
                  className="flex-shrink-0 h-9 w-9"
                >
                  {isAnswering ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Normal answered state - clickable to edit (except signatures)
    return (
      <Card
        className={`group border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800 ${
          !isSignatureOrInitials ? "cursor-pointer hover:bg-green-100/50 dark:hover:bg-green-900/30 transition-colors" : ""
        }`}
        onClick={!isSignatureOrInitials ? handleStartEdit : undefined}
      >
        <CardContent className="px-2 py-1.5">
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
            {!isSignatureOrInitials && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartEdit();
                }}
                title="Edit answer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
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
        // Checkbox fields show Yes/No buttons - click to select and submit (like circle_choice)
        return (
          <div className="flex flex-wrap gap-2">
            {[{ label: "Yes", value: "true" }, { label: "No", value: "false" }].map((choice) => (
              <Button
                key={choice.value}
                variant={answer === choice.value ? "default" : "outline"}
                size="sm"
                disabled={isAnswering}
                onClick={async (e) => {
                  e.stopPropagation();
                  setAnswer(choice.value);
                  await onAnswer(choice.value);
                }}
                className="transition-all"
              >
                {choice.label}
              </Button>
            ))}
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

      case "radio": {
        // Radio button fields show all options - click to select and submit
        const choices = question.choices || [];
        return (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice.label}
                variant={answer === choice.label ? "default" : "outline"}
                size="sm"
                disabled={isAnswering}
                onClick={async (e) => {
                  e.stopPropagation();
                  setAnswer(choice.label);
                  await onAnswer(choice.label);
                }}
                className="transition-all"
              >
                {choice.label}
              </Button>
            ))}
          </div>
        );
      }

      case "circle_choice": {
        // Circle choice fields show all options - click to select and submit
        const choices = question.choices || [];
        return (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice.label}
                variant={answer === choice.label ? "default" : "outline"}
                size="sm"
                disabled={isAnswering}
                onClick={async (e) => {
                  e.stopPropagation();
                  setAnswer(choice.label);
                  await onAnswer(choice.label);
                }}
                className="transition-all"
              >
                {choice.label}
              </Button>
            ))}
          </div>
        );
      }

      case "memory_choice": {
        const choices = question.choices || [];

        if (showOtherInput) {
          return (
            <div className="space-y-2">
              <Input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter a different answer..."
                disabled={isAnswering}
                autoFocus
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowOtherInput(false);
                  setAnswer("");
                }}
                disabled={isAnswering}
              >
                ← Back to choices
              </Button>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <Button
                  key={choice.label}
                  variant="outline"
                  size="sm"
                  disabled={isAnswering}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onMemoryChoiceSelect) {
                      onMemoryChoiceSelect(choice);
                    }
                  }}
                  className="transition-all hover:bg-primary hover:text-primary-foreground"
                >
                  {choice.label}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowOtherInput(true);
              }}
              disabled={isAnswering}
              className="text-muted-foreground"
            >
              Other...
            </Button>
          </div>
        );
      }

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
      <CardContent className="px-2 py-1.5">
        <div className="space-y-1">
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
          ) : question.input_type === "radio" ? (
            // Radio buttons - click to select and auto-submit
            <div>{renderInput()}</div>
          ) : question.input_type === "circle_choice" ? (
            // Circle choice with buttons - click to select and auto-submit
            <div>{renderInput()}</div>
          ) : question.input_type === "checkbox" ? (
            // Checkbox with Yes/No buttons - click to select and auto-submit
            <div>{renderInput()}</div>
          ) : question.input_type === "memory_choice" && !showOtherInput ? (
            // Memory choice with pre-built buttons - no submit needed
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
