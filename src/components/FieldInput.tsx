"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SparkleIcon } from "@/components/icons/SparkleIcon";
import { SignatureField } from "@/components/signature";
import type { ExtractedField } from "@/lib/types";

interface FieldInputProps {
  field: ExtractedField;
  value: string;
  onChange: (value: string) => void;
}

export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const hasAISuggestion =
    field.ai_suggested_value &&
    field.ai_suggested_value !== value &&
    value === "";

  const applySuggestion = () => {
    if (field.ai_suggested_value) {
      onChange(field.ai_suggested_value);
    }
  };

  const renderInput = () => {
    switch (field.field_type) {
      case "textarea":
        return (
          <Textarea
            id={field.id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.ai_suggested_value || `Enter ${field.label}`}
            rows={4}
            className="resize-none"
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={field.id}
              checked={value === "true" || value === "yes"}
              onCheckedChange={(checked) =>
                onChange(checked ? "true" : "false")
              }
            />
            <Label htmlFor={field.id} className="text-sm cursor-pointer">
              {field.ai_suggested_value || "Check to confirm"}
            </Label>
          </div>
        );

      case "date":
        return (
          <Input
            id={field.id}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "signature":
        return (
          <SignatureField
            value={value}
            onChange={onChange}
            type="signature"
          />
        );

      case "initials":
        return (
          <SignatureField
            value={value}
            onChange={onChange}
            type="initials"
          />
        );

      default:
        return (
          <Input
            id={field.id}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.ai_suggested_value || `Enter ${field.label}`}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={field.id} className="text-base font-medium">
          {field.label}
        </Label>
        <Badge variant="outline" className="text-xs capitalize">
          {field.field_type}
        </Badge>
        {field.ai_confidence !== null && field.ai_confidence > 0.8 && (
          <Badge variant="secondary" className="text-xs">
            High confidence
          </Badge>
        )}
      </div>

      {field.help_text && (
        <p className="text-sm text-muted-foreground">{field.help_text}</p>
      )}

      {renderInput()}

      {hasAISuggestion && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <SparkleIcon className="h-4 w-4 text-blue-500" />
          <span className="text-sm text-blue-700 dark:text-blue-300 flex-1">
            AI suggested:{" "}
            <span className="font-medium">{field.ai_suggested_value}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={applySuggestion}
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900"
          >
            Use this
          </Button>
        </div>
      )}
    </div>
  );
}
