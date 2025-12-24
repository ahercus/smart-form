"use client";

import { getFieldClasses, type BaseFieldOverlayProps } from "./types";

export function ReadonlyFieldOverlay({
  field,
  value,
  pixelCoords,
  isActive,
  isHighlighted,
  isFilled,
  onClick,
  onDoubleClick,
}: BaseFieldOverlayProps) {
  const baseClasses = getFieldClasses(isActive, isHighlighted, isFilled);

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
      onClick={() => onClick(field.id)}
      onDoubleClick={() => onDoubleClick(field.id)}
      title={`${field.label}${value ? `: ${value}` : ""}`}
    >
      {isFilled && (
        <span className="absolute inset-0 px-1 text-xs text-gray-700 dark:text-gray-300 pointer-events-none whitespace-pre-wrap overflow-hidden">
          {value}
        </span>
      )}
      <div className="absolute -top-6 left-0 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
        {field.label}
      </div>
    </div>
  );
}
