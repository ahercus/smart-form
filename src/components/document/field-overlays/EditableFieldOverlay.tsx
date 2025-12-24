"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EditableFieldOverlayProps } from "./types";

export function EditableFieldOverlay({
  field,
  value,
  pixelCoords,
  onValueChange,
  onBlur,
  containerWidth,
}: EditableFieldOverlayProps) {
  const isDateField = field.field_type === "date";

  return (
    <div
      className="absolute z-20 border-2 border-blue-500 ring-2 ring-blue-500 ring-offset-1 bg-blue-500/10"
      style={{
        left: pixelCoords.x,
        top: pixelCoords.y,
        width: Math.max(pixelCoords.width, containerWidth * 0.15),
        minHeight: pixelCoords.height,
      }}
    >
      {isDateField ? (
        <Input
          type="date"
          value={value}
          onChange={(e) => onValueChange(field.id, e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onBlur();
            }
          }}
          className="h-full w-full text-xs p-1 bg-transparent border-0 focus:ring-0 focus-visible:ring-0"
          autoFocus
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => {
            onValueChange(field.id, e.target.value);
            // Auto-resize textarea
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onBlur();
            }
          }}
          className="w-full text-xs p-1 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 resize-none overflow-hidden"
          style={{ minHeight: pixelCoords.height }}
          autoFocus
          rows={1}
        />
      )}
    </div>
  );
}
