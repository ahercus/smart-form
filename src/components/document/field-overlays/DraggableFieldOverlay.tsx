"use client";

import { useRef, useCallback } from "react";
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
}: DraggableFieldOverlayProps) {
  // Track if we just finished dragging to prevent click from firing
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const isSignature = isSignatureField(field.field_type);
  const isImageValue = value?.startsWith("data:image");
  const hasFilledSignature = isSignature && isFilled && isImageValue;
  const baseClasses = isSignature
    ? getSignatureFieldClasses(isActive, isHighlighted, isFilled, isImageValue)
    : getFieldClasses(isActive, isHighlighted, isFilled);

  const handleDragStart = useCallback(
    (_e: unknown, d: { x: number; y: number }) => {
      isDraggingRef.current = true;
      dragStartPosRef.current = { x: d.x, y: d.y };
      onClick(field.id);
    },
    [onClick, field.id]
  );

  const handleDrag = useCallback(
    (_e: unknown, d: { x: number; y: number }) => {
      const newCoords: NormalizedCoordinates = {
        left: (d.x / containerSize.width) * 100,
        top: (d.y / containerSize.height) * 100,
        width: coords.width,
        height: coords.height,
      };
      onLocalCoordsChange(field.id, newCoords);
    },
    [containerSize, coords.width, coords.height, onLocalCoordsChange, field.id]
  );

  const handleDragStop = useCallback(
    (_e: unknown, d: { x: number; y: number }) => {
      const newCoords: NormalizedCoordinates = {
        left: (d.x / containerSize.width) * 100,
        top: (d.y / containerSize.height) * 100,
        width: coords.width,
        height: coords.height,
      };
      onLocalCoordsChange(field.id, newCoords);
      onCoordinatesChange(field.id, newCoords);

      // Check if we actually moved (vs just clicking)
      const startPos = dragStartPosRef.current;
      const didMove =
        startPos && (Math.abs(d.x - startPos.x) > 3 || Math.abs(d.y - startPos.y) > 3);

      // Keep isDragging true briefly if we moved, to block the click event
      if (didMove) {
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      } else {
        isDraggingRef.current = false;
      }
      dragStartPosRef.current = null;
    },
    [containerSize, coords.width, coords.height, onLocalCoordsChange, onCoordinatesChange, field.id]
  );

  const handleResizeStart = useCallback(() => {
    isDraggingRef.current = true;
    onClick(field.id);
  }, [onClick, field.id]);

  const handleResize = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      ref: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number }
    ) => {
      const newCoords = pixelToPercent(
        position.x,
        position.y,
        ref.offsetWidth,
        ref.offsetHeight
      );
      onLocalCoordsChange(field.id, newCoords);
    },
    [pixelToPercent, onLocalCoordsChange, field.id]
  );

  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      ref: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number }
    ) => {
      const newCoords = pixelToPercent(
        position.x,
        position.y,
        ref.offsetWidth,
        ref.offsetHeight
      );
      onLocalCoordsChange(field.id, newCoords);
      onCoordinatesChange(field.id, newCoords);

      setTimeout(() => {
        isDraggingRef.current = false;
      }, 100);
    },
    [pixelToPercent, onLocalCoordsChange, onCoordinatesChange, field.id]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // Don't fire click if we just finished dragging
      if (isDraggingRef.current) {
        return;
      }

      // Signature fields: single click opens manager to insert or replace
      if (isSignature && onSignatureClick) {
        onSignatureClick(field.id, field.field_type as SignatureType);
      } else {
        onClick(field.id);
      }
    },
    [isSignature, onSignatureClick, onClick, field.id, field.field_type]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // Don't fire if we just finished dragging
      if (isDraggingRef.current) {
        return;
      }

      if (hasFilledSignature && onSignatureClick) {
        onSignatureClick(field.id, field.field_type as SignatureType);
      } else if (isSignature && onSignatureClick) {
        onSignatureClick(field.id, field.field_type as SignatureType);
      } else {
        onDoubleClick(field.id);
      }
    },
    [hasFilledSignature, isSignature, onSignatureClick, onDoubleClick, field.id, field.field_type]
  );

  return (
    <Rnd
      key={field.id}
      position={{ x: pixelCoords.x, y: pixelCoords.y }}
      size={{ width: pixelCoords.width, height: pixelCoords.height }}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      onResizeStart={handleResizeStart}
      onResize={handleResize}
      onResizeStop={handleResizeStop}
      bounds="parent"
      minWidth={20}
      minHeight={10}
      // Disable native HTML5 drag which can cause ghost image issues
      disableDragging={false}
      enableUserSelectHack={false}
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
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={`${field.label}${value && !isImageValue ? `: ${value}` : ""}`}
      >
        {isSignature ? (
          // Signature/Initials field rendering
          isFilled && isImageValue ? (
            <div className="absolute inset-0 p-0.5 pointer-events-none">
              <Image
                src={value}
                alt={field.field_type === "signature" ? "Signature" : "Initials"}
                fill
                className="object-contain"
                draggable={false}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center gap-1 text-muted-foreground pointer-events-none">
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
