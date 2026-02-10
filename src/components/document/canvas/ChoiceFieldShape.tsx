"use client";

/**
 * ChoiceFieldShape - Renders circle_choice fields on canvas
 *
 * Each option is an ellipse that can be clicked to select.
 * Selected options show with a solid circle border.
 */

import { Group, Ellipse, Rect } from "react-konva";
import { useState } from "react";
import type { ExtractedField } from "@/lib/types";

interface ChoiceFieldShapeProps {
  field: ExtractedField;
  value: string; // Comma-separated selected options
  /** Page dimensions for coordinate conversion */
  pageWidth: number;
  pageHeight: number;
  isActive: boolean;
  hideFieldColors?: boolean;
  onClick: (optionLabel: string) => void;
}

const COLOR = "#f97316"; // orange

// Parse comma-separated value into array of selected options
function parseSelected(value: string): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function ChoiceFieldShape({
  field,
  value,
  pageWidth,
  pageHeight,
  isActive,
  hideFieldColors,
  onClick,
}: ChoiceFieldShapeProps) {
  const [isHovering, setIsHovering] = useState(false);
  const choiceOptions = field.choice_options || [];
  const selected = parseSelected(value);
  const hasSelection = selected.length > 0;
  const padding = 4;

  // Filter out options with missing coordinates (Gemini sometimes omits them)
  const validOptions = choiceOptions.filter((opt) => opt.coordinates?.left != null);

  if (validOptions.length === 0) {
    return null;
  }

  // Calculate bounding box for hover detection
  const allPixels = validOptions.map((opt) => ({
    x: (opt.coordinates.left / 100) * pageWidth,
    y: (opt.coordinates.top / 100) * pageHeight,
    width: (opt.coordinates.width / 100) * pageWidth,
    height: (opt.coordinates.height / 100) * pageHeight,
  }));

  const minX = Math.min(...allPixels.map((p) => p.x)) - padding;
  const minY = Math.min(...allPixels.map((p) => p.y)) - padding;
  const maxX = Math.max(...allPixels.map((p) => p.x + p.width)) + padding;
  const maxY = Math.max(...allPixels.map((p) => p.y + p.height)) + padding;

  return (
    <Group>
      {/* Invisible hover detection area */}
      <Rect
        x={minX}
        y={minY}
        width={maxX - minX}
        height={maxY - minY}
        fill="transparent"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      />

      {/* Choice options */}
      {validOptions.map((option) => {
        const isSelected = selected.includes(option.label);
        const x = (option.coordinates.left / 100) * pageWidth;
        const y = (option.coordinates.top / 100) * pageHeight;
        const w = (option.coordinates.width / 100) * pageWidth;
        const h = (option.coordinates.height / 100) * pageHeight;

        // Hide unselected options when there's a selection (unless hovering)
        const shouldHide = (hasSelection || hideFieldColors) && !isSelected && !isHovering && !isActive;
        const opacity = shouldHide ? 0 : 1;

        // Center of ellipse
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const radiusX = w / 2 + padding;
        const radiusY = h / 2 + padding;

        // Determine fill based on state
        let fill = "transparent";
        if (!hideFieldColors && !isSelected) {
          if (isActive) {
            fill = `${COLOR}15`;
          } else {
            fill = `${COLOR}08`;
          }
        }

        // Stroke for selected or unselected
        const stroke = isSelected ? "#000000" : hideFieldColors ? "transparent" : `${COLOR}40`;
        const strokeWidth = isSelected ? 2 : 1;

        return (
          <Ellipse
            key={`${field.id}-${option.label}`}
            x={centerX}
            y={centerY}
            radiusX={radiusX}
            radiusY={radiusY}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
            onClick={() => onClick(option.label)}
            onTap={() => onClick(option.label)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          />
        );
      })}
    </Group>
  );
}
