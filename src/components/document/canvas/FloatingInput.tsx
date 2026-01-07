"use client";

/**
 * FloatingInput - HTML input overlay for text entry on canvas
 *
 * Positioned absolutely over the Konva canvas, styled to be transparent
 * so the canvas text shows through during typing.
 */

import { useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExtractedField } from "@/lib/types";

interface FloatingInputProps {
  field: ExtractedField;
  value: string;
  /** Position in screen pixels (already scaled) */
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scale: number;
  onValueChange: (fieldId: string, value: string) => void;
  onClose: () => void;
}

export function FloatingInput({
  field,
  value,
  position,
  scale,
  onValueChange,
  onClose,
}: FloatingInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isDateField = field.field_type === "date";
  const isTextarea = field.field_type === "textarea";

  // Focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onValueChange(field.id, e.target.value);
    },
    [field.id, onValueChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !isTextarea) {
        // Single-line fields close on Enter
        onClose();
      } else if (e.key === "Tab") {
        // Allow tab to move to next field (will be handled by parent)
        e.preventDefault();
        onClose();
      }
    },
    [isTextarea, onClose]
  );

  const handleBlur = useCallback(() => {
    onClose();
  }, [onClose]);

  // Calculate font size based on field height and scale
  const baseFontSize = Math.min(Math.max(position.height * 0.5, 10), 14);
  const fontSize = baseFontSize;
  const padding = 2 * scale;

  const commonStyles: React.CSSProperties = {
    position: "absolute",
    left: position.x + padding,
    top: position.y,
    width: position.width - padding * 2,
    height: isTextarea ? "auto" : position.height,
    minHeight: position.height,
    fontSize,
    lineHeight: isTextarea ? "1.2" : `${position.height}px`,
    padding: `0 ${padding}px`,
    color: "#374151",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    boxShadow: "none",
    resize: "none",
    overflow: "hidden",
  };

  if (isDateField) {
    return (
      <Input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="date"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={commonStyles}
        className="focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    );
  }

  if (isTextarea) {
    return (
      <Textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={commonStyles}
        className="focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        rows={1}
      />
    );
  }

  return (
    <Input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={commonStyles}
      className="focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
}
