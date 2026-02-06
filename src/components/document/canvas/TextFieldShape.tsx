"use client";

/**
 * TextFieldShape - Renders text, textarea, and date fields on canvas
 *
 * Shows:
 * - Field box with border
 * - Field value inside the box
 */

import { Group, Rect, Text } from "react-konva";
import type { ExtractedField } from "@/lib/types";

interface TextFieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Pixel coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
  isEditing: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
}

// Field type colors
const COLORS = {
  text: "#3b82f6", // blue
  textarea: "#8b5cf6", // purple
  date: "#f59e0b", // amber
  default: "#6b7280", // gray
};

export function TextFieldShape({
  field,
  value,
  x,
  y,
  width,
  height,
  isActive,
  isEditing,
  hideFieldColors,
  onClick,
}: TextFieldShapeProps) {
  const color = COLORS[field.field_type as keyof typeof COLORS] || COLORS.default;

  // Calculate font size based on field height
  const fontSize = Math.min(Math.max(height * 0.5, 8), 12);
  const padding = 4;

  // Determine background and border styles
  const bgFill = isEditing
    ? `${color}10`
    : hideFieldColors
    ? "transparent"
    : isActive
    ? `${color}15`
    : `${color}08`;

  const strokeColor = isEditing ? color : isActive ? color : hideFieldColors ? "transparent" : `${color}80`;
  const strokeWidth = isEditing ? 2 : isActive ? 1.5 : 1;

  return (
    <Group
      onClick={onClick}
      onTap={onClick}
    >
      {/* Field box */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={bgFill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        cornerRadius={2}
      />

      {/* Field value (hidden when editing since FloatingInput shows) */}
      {!isEditing && value && (
        <Text
          x={x + padding}
          y={y + (height - fontSize) / 2}
          width={width - padding * 2}
          text={value}
          fontSize={fontSize}
          fill="#374151"
          ellipsis
          wrap="none"
        />
      )}
    </Group>
  );
}
