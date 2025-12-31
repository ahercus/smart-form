"use client";

import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

interface ChoiceFieldOverlayProps {
  field: ExtractedField;
  value: string; // Comma-separated selected options: "Yes" or "Yes,No"
  containerSize: { width: number; height: number };
  isActive: boolean;
  isHighlighted: boolean;
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
  onClick,
  onValueChange,
}: ChoiceFieldOverlayProps) {
  const choiceOptions = field.choice_options || [];
  const selected = parseSelected(value);

  if (containerSize.width === 0 || choiceOptions.length === 0) {
    return null;
  }

  const handleOptionClick = (e: React.MouseEvent, optionLabel: string) => {
    e.stopPropagation();
    const newValue = toggleOption(value, optionLabel);
    onValueChange(field.id, newValue);
    onClick(field.id);
  };

  return (
    <>
      {choiceOptions.map((option) => {
        const isSelected = selected.includes(option.label);
        const pixel = toPixels(option.coordinates, containerSize);

        // Add padding for the circle
        const padding = 4;
        const circleStyle = {
          left: pixel.x - padding,
          top: pixel.y - padding,
          width: pixel.width + padding * 2,
          height: pixel.height + padding * 2,
        };

        return (
          <div
            key={`${field.id}-${option.label}`}
            className={`absolute cursor-pointer transition-all rounded-full ${
              isSelected
                ? "border-2 border-black bg-transparent"
                : isActive || isHighlighted
                  ? "bg-purple-500/15 hover:bg-purple-500/25"
                  : "bg-orange-400/10 hover:bg-orange-400/20"
            }`}
            style={circleStyle}
            onClick={(e) => handleOptionClick(e, option.label)}
            title={`${field.label}: ${option.label}`}
          />
        );
      })}
    </>
  );
}
