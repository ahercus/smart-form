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
  /** Consistent font size for all text fields on this page (based on smallest field) */
  pageFontSize?: number | null;
  onValueChange: (fieldId: string, value: string) => void;
  onClose: () => void;
}

export function FloatingInput({
  field,
  value,
  position,
  scale,
  pageFontSize,
  onValueChange,
  onClose,
}: FloatingInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isDateField = field.field_type === "date";
  const isTextarea = field.field_type === "textarea";

  // Focus on mount, then scroll into view for mobile virtual keyboard
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    const scrollTimer = setTimeout(() => {
      inputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 350);

    return () => {
      clearTimeout(timer);
      clearTimeout(scrollTimer);
    };
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

  // Use page-consistent font size if provided, otherwise fall back to per-field calculation
  // This ensures all text fields on the page have the same text size when typing
  const fontSize = pageFontSize ?? Math.min(Math.max(position.height * 0.75, 10), 24);
  const horizontalPadding = 2 * scale;

  // Calculate vertical padding to center text within field height
  const verticalPadding = Math.max(0, (position.height - fontSize) / 2);

  const wrapperStyles: React.CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    width: position.width,
    height: position.height,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
  };

  const commonStyles: React.CSSProperties = {
    width: "100%",
    height: isTextarea ? "auto" : "100%",
    minHeight: isTextarea ? position.height : undefined,
    fontSize,
    lineHeight: isTextarea ? "1.2" : "1",
    padding: isTextarea
      ? `2px ${horizontalPadding}px`
      : `${verticalPadding}px ${horizontalPadding}px`,
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
      <div style={wrapperStyles}>
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
      </div>
    );
  }

  if (isTextarea) {
    return (
      <div style={{ ...wrapperStyles, alignItems: "flex-start" }}>
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
      </div>
    );
  }

  return (
    <div style={wrapperStyles}>
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
    </div>
  );
}
