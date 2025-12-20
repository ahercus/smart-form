"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, ChevronRight } from "lucide-react";
import type { QuestionGroup } from "@/lib/types";

interface QuestionCardProps {
  question: QuestionGroup;
  isActive: boolean;
  onAnswer: (answer: string) => Promise<void>;
  isAnswering: boolean;
}

export function QuestionCard({
  question,
  isActive,
  onAnswer,
  isAnswering,
}: QuestionCardProps) {
  const [answer, setAnswer] = useState(question.answer || "");

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

  if (question.status === "answered") {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground line-through">
                {question.question}
              </p>
              <p className="text-sm font-medium mt-1 truncate">
                {question.answer}
              </p>
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
      className={`transition-all ${
        isActive
          ? "ring-2 ring-primary shadow-md"
          : "hover:shadow-sm"
      }`}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{question.question}</p>
            {question.profile_key && (
              <Badge variant="outline" className="text-xs flex-shrink-0">
                {question.profile_key}
              </Badge>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">{renderInput()}</div>
            <Button
              onClick={handleSubmit}
              disabled={!answer.trim() || isAnswering}
              size="icon"
              className="flex-shrink-0"
            >
              {isAnswering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>

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
