"use client";

import { useState } from "react";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

interface ChoiceFieldOverlayProps {
  field: ExtractedField;
  value: string; // Comma-separated selected options: "Yes" or "Yes,No"
  containerSize: { width: number; height: number };
  isActive: boolean;
  isHighlighted: boolean;
  /** When true, hides background colors but keeps hover effects and functionality */
  hideFieldColors?: boolean;
  onClick: (fieldId: string) => void;
  onValueChange: (fieldId: string, value: string) => void;
}

// Convert normalized coordinates to pixel coordinates
function toPixels(
  coords: NormalizedCoordinates,
  containerSize: { width: number; height: number }
) {
  return {
    x: (coords.left / 100) * containerSize.width,
    y: (coords.top / 100) * containerSize.height,
    width: (coords.width / 100) * containerSize.width,
    height: (coords.height / 100) * containerSize.height,
  };
}

// Parse comma-separated value into array of selected options
function parseSelected(value: string): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// Toggle an option in the selection
function toggleOption(currentValue: string, option: string): string {
  const selected = parseSelected(currentValue);
  const index = selected.indexOf(option);

  if (index >= 0) {
    // Remove it
    selected.splice(index, 1);
  } else {
    // Add it
    selected.push(option);
  }

  return selected.join(",");
}

export function ChoiceFieldOverlay({
  field,
  value,
  containerSize,
  isActive,
  isHighlighted,
  hideFieldColors,
  onClick,
  onValueChange,
}: ChoiceFieldOverlayProps) {
  const [isHovering, setIsHovering] = useState(false);
  const choiceOptions = field.choice_options || [];
  const selected = parseSelected(value);
  const hasSelection = selected.length > 0;

  if (containerSize.width === 0 || choiceOptions.length === 0) {
    return null;
  }

  const handleOptionClick = (e: React.MouseEvent, optionLabel: string) => {
    e.stopPropagation();
    const newValue = toggleOption(value, optionLabel);
    onValueChange(field.id, newValue);
    onClick(field.id);
  };

  // Calculate bounding box for all options to create hover area
  const allPixels = choiceOptions.map((opt) => toPixels(opt.coordinates, containerSize));
  const padding = 4;
  const minX = Math.min(...allPixels.map((p) => p.x)) - padding;
  const minY = Math.min(...allPixels.map((p) => p.y)) - padding;
  const maxX = Math.max(...allPixels.map((p) => p.x + p.width)) + padding;
  const maxY = Math.max(...allPixels.map((p) => p.y + p.height)) + padding;

  return (
    <>
      {/* Invisible hover area covering all options */}
      <div
        className="absolute"
        style={{
          left: minX,
          top: minY,
          width: maxX - minX,
          height: maxY - minY,
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      />
      {choiceOptions.map((option) => {
        const isSelected = selected.includes(option.label);
        const pixel = toPixels(option.coordinates, containerSize);

        // Hide unselected options unless hovering (when there's a selection or hideFieldColors is on)
        const shouldHide = (hasSelection || hideFieldColors) && !isSelected && !isHovering;

        const circleStyle = {
          left: pixel.x - padding,
          top: pixel.y - padding,
          width: pixel.width + padding * 2,
          height: pixel.height + padding * 2,
        };

        // Determine classes based on state
        const getOptionClasses = () => {
          if (isSelected) {
            return "border-2 border-black bg-transparent";
          }
          if (hideFieldColors && !isActive) {
            return "hover:bg-gray-500/10";
          }
          if (isActive || isHighlighted) {
            return "bg-primary/15 hover:bg-primary/25";
          }
          return "bg-orange-400/10 hover:bg-orange-400/20";
        };

        return (
          <div
            key={`${field.id}-${option.label}`}
            className={`absolute cursor-pointer transition-all rounded-full ${getOptionClasses()} ${shouldHide ? "opacity-0" : "opacity-100"}`}
            style={circleStyle}
            onClick={(e) => handleOptionClick(e, option.label)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            title={`${field.label}: ${option.label}`}
          />
        );
      })}
    </>
  );
}
