"use client";

/**
 * CheckboxFieldShape - Renders checkbox fields on canvas
 *
 * Shows:
 * - Checkbox box with border
 * - X mark when checked
 */

import { Group, Rect, Line } from "react-konva";
import type { ExtractedField } from "@/lib/types";

interface CheckboxFieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Pixel coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const COLOR = "#10b981"; // green

export function CheckboxFieldShape({
  field,
  value,
  x,
  y,
  width,
  height,
  isActive,
  hideFieldColors,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: CheckboxFieldShapeProps) {
  const isChecked = value === "yes" || value === "true";
  const padding = Math.min(width, height) * 0.15;

  // Determine styles
  const bgFill = hideFieldColors
    ? "transparent"
    : isActive
    ? `${COLOR}15`
    : `${COLOR}08`;

  const strokeColor = hideFieldColors ? "transparent" : isActive ? COLOR : `${COLOR}80`;
  const strokeWidth = isActive ? 1.5 : 1;

  return (
    <Group
      onClick={onClick}
      onTap={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Checkbox box */}
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

      {/* X mark when checked */}
      {isChecked && (
        <>
          <Line
            points={[
              x + padding,
              y + padding,
              x + width - padding,
              y + height - padding,
            ]}
            stroke="#000000"
            strokeWidth={2}
            lineCap="round"
          />
          <Line
            points={[
              x + padding,
              y + height - padding,
              x + width - padding,
              y + padding,
            ]}
            stroke="#000000"
            strokeWidth={2}
            lineCap="round"
          />
        </>
      )}
    </Group>
  );
}
