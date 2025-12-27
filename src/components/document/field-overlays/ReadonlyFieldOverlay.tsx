"use client";

import Image from "next/image";
import { PenLine } from "lucide-react";
import {
  getFieldClasses,
  getSignatureFieldClasses,
  isSignatureField,
  type BaseFieldOverlayProps,
} from "./types";
import type { SignatureType } from "@/lib/types";

export function ReadonlyFieldOverlay({
  field,
  value,
  pixelCoords,
  isActive,
  isHighlighted,
  isFilled,
  onClick,
  onDoubleClick,
  onSignatureClick,
}: BaseFieldOverlayProps) {
  const isSignature = isSignatureField(field.field_type);
  const baseClasses = isSignature
    ? getSignatureFieldClasses(isActive, isHighlighted, isFilled)
    : getFieldClasses(isActive, isHighlighted, isFilled);

  // Check if the value is a data URL (signature image)
  const isImageValue = value?.startsWith("data:image");

  const handleClick = () => {
    if (isSignature && onSignatureClick) {
      onSignatureClick(field.id, field.field_type as SignatureType);
    } else {
      onClick(field.id);
    }
  };

  return (
    <div
      key={field.id}
      className={`absolute cursor-pointer group ${baseClasses}`}
      style={{
        left: pixelCoords.x,
        top: pixelCoords.y,
        width: pixelCoords.width,
        height: pixelCoords.height,
      }}
      onClick={handleClick}
      onDoubleClick={() => {
        if (isSignature && onSignatureClick) {
          onSignatureClick(field.id, field.field_type as SignatureType);
        } else {
          onDoubleClick(field.id);
        }
      }}
      title={`${field.label}${value && !isImageValue ? `: ${value}` : ""}`}
    >
      {isSignature ? (
        // Signature/Initials field rendering
        isFilled && isImageValue ? (
          // Show signature image
          <div className="absolute inset-0 p-0.5">
            <Image
              src={value}
              alt={field.field_type === "signature" ? "Signature" : "Initials"}
              fill
              className="object-contain"
            />
          </div>
        ) : (
          // Show placeholder with icon
          <div className="absolute inset-0 flex items-center justify-center gap-1 text-muted-foreground">
            <PenLine className="h-3 w-3" />
            <span className="text-xs font-medium">
              {field.field_type === "signature" ? "Sign" : "Initial"}
            </span>
          </div>
        )
      ) : (
        // Regular field rendering
        isFilled && (
          <span className="absolute inset-0 px-1 text-xs text-gray-700 dark:text-gray-300 pointer-events-none whitespace-pre-wrap overflow-hidden">
            {value}
          </span>
        )
      )}
      <div className="absolute -top-6 left-0 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
        {field.label}
      </div>
    </div>
  );
}
