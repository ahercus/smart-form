"use client";

import Image from "next/image";
import { Rnd } from "react-rnd";
import { PenLine } from "lucide-react";
import type { NormalizedCoordinates, SignatureType } from "@/lib/types";
import {
  getFieldClasses,
  getSignatureFieldClasses,
  isSignatureField,
  type DraggableFieldOverlayProps,
} from "./types";

export function DraggableFieldOverlay({
  field,
  value,
  pixelCoords,
  coords,
  containerSize,
  isActive,
  isHighlighted,
  isFilled,
  onClick,
  onDoubleClick,
  onCoordinatesChange,
  onLocalCoordsChange,
  pixelToPercent,
  onSignatureClick,
  onSwitchToPointerMode,
}: DraggableFieldOverlayProps) {
  const isSignature = isSignatureField(field.field_type);
  const isImageValue = value?.startsWith("data:image");
  const hasFilledSignature = isSignature && isFilled && isImageValue;
  const baseClasses = isSignature
    ? getSignatureFieldClasses(isActive, isHighlighted, isFilled, isImageValue)
    : getFieldClasses(isActive, isHighlighted, isFilled);

  return (
    <Rnd
      key={field.id}
      position={{ x: pixelCoords.x, y: pixelCoords.y }}
      size={{ width: pixelCoords.width, height: pixelCoords.height }}
      onDragStart={() => {
        onClick(field.id);
      }}
      onDrag={(_e, d) => {
        const newCoords: NormalizedCoordinates = {
          left: (d.x / containerSize.width) * 100,
          top: (d.y / containerSize.height) * 100,
          width: coords.width,
          height: coords.height,
        };
        onLocalCoordsChange(field.id, newCoords);
      }}
      onDragStop={(_e, d) => {
        const newCoords: NormalizedCoordinates = {
          left: (d.x / containerSize.width) * 100,
          top: (d.y / containerSize.height) * 100,
          width: coords.width,
          height: coords.height,
        };
        onLocalCoordsChange(field.id, newCoords);
        onCoordinatesChange(field.id, newCoords);
      }}
      onResizeStart={() => {
        onClick(field.id);
      }}
      onResize={(_e, _direction, ref, _delta, position) => {
        const newCoords = pixelToPercent(
          position.x,
          position.y,
          ref.offsetWidth,
          ref.offsetHeight
        );
        onLocalCoordsChange(field.id, newCoords);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        const newCoords = pixelToPercent(
          position.x,
          position.y,
          ref.offsetWidth,
          ref.offsetHeight
        );
        onLocalCoordsChange(field.id, newCoords);
        onCoordinatesChange(field.id, newCoords);
      }}
      bounds="parent"
      minWidth={20}
      minHeight={10}
      resizeHandleStyles={
        isActive
          ? {
              topLeft: {
                width: 10,
                height: 10,
                top: -5,
                left: -5,
                cursor: "nw-resize",
                background: "#3b82f6",
                borderRadius: 2,
                border: "1px solid white",
              },
              topRight: {
                width: 10,
                height: 10,
                top: -5,
                right: -5,
                cursor: "ne-resize",
                background: "#3b82f6",
                borderRadius: 2,
                border: "1px solid white",
              },
              bottomLeft: {
                width: 10,
                height: 10,
                bottom: -5,
                left: -5,
                cursor: "sw-resize",
                background: "#3b82f6",
                borderRadius: 2,
                border: "1px solid white",
              },
              bottomRight: {
                width: 10,
                height: 10,
                bottom: -5,
                right: -5,
                cursor: "se-resize",
                background: "#3b82f6",
                borderRadius: 2,
                border: "1px solid white",
              },
            }
          : {}
      }
      resizeHandleClasses={{
        topLeft: "z-30",
        topRight: "z-30",
        bottomLeft: "z-30",
        bottomRight: "z-30",
      }}
      enableResizing={
        isActive
          ? {
              top: false,
              right: false,
              bottom: false,
              left: false,
              topLeft: true,
              topRight: true,
              bottomLeft: true,
              bottomRight: true,
            }
          : false
      }
      className={isActive ? "z-20" : "z-10"}
    >
      <div
        className={`${baseClasses} cursor-move group relative`}
        onClick={(e) => {
          e.stopPropagation(); // Prevent background deselect
          // Signature fields: single click opens manager to insert or replace
          if (isSignature && onSignatureClick) {
            onSignatureClick(field.id, field.field_type as SignatureType);
          } else {
            onClick(field.id);
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation(); // Prevent background deselect
          // Filled signature: double click opens manager to replace
          if (hasFilledSignature && onSignatureClick) {
            onSignatureClick(field.id, field.field_type as SignatureType);
          } else if (isSignature && onSignatureClick) {
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
            <div className="absolute inset-0 p-0.5">
              <Image
                src={value}
                alt={field.field_type === "signature" ? "Signature" : "Initials"}
                fill
                className="object-contain"
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center gap-1 text-muted-foreground">
              <PenLine className="h-3 w-3" />
              <span className="text-xs font-medium">
                {field.field_type === "signature" ? "Sign" : "Initial"}
              </span>
            </div>
          )
        ) : (
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
    </Rnd>
  );
}
