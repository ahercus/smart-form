"use client";

/**
 * LinkedDateFieldShape - Renders segmented date fields (DD/MM/YYYY boxes)
 *
 * Renders each date segment (day, month, year) as a separate box,
 * with the appropriate part of the date value displayed in each.
 */

import { Group, Rect, Text } from "react-konva";
import type { ExtractedField, DateSegment } from "@/lib/types";

interface LinkedDateFieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Page dimensions for coordinate conversion */
  pageWidth: number;
  pageHeight: number;
  /** Consistent font size for all text fields on this page */
  pageFontSize?: number | null;
  isActive: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
}

// Parse a date value into day, month, year parts
// Accepts ISO format (YYYY-MM-DD), AU/UK format (DD/MM/YYYY), or US format (MM/DD/YYYY)
function parseDateValue(value: string): { day: string; month: string; year: string; year2: string } | null {
  if (!value) return null;

  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return {
      day,
      month,
      year,
      year2: year.slice(-2),
    };
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return {
      day: day.padStart(2, "0"),
      month: month.padStart(2, "0"),
      year,
      year2: year.slice(-2),
    };
  }

  // Try MM/DD/YYYY (US format) - harder to distinguish, assume DD/MM/YYYY is more common
  // If first number > 12, it's definitely day-first
  const parts = value.split(/[\/\-]/);
  if (parts.length === 3) {
    const [first, second, third] = parts;
    // If third part is 4 digits, it's the year
    if (third.length === 4) {
      return {
        day: first.padStart(2, "0"),
        month: second.padStart(2, "0"),
        year: third,
        year2: third.slice(-2),
      };
    }
  }

  return null;
}

const COLOR = "#f59e0b"; // amber for dates

export function LinkedDateFieldShape({
  field,
  value,
  pageWidth,
  pageHeight,
  pageFontSize,
  isActive,
  hideFieldColors,
  onClick,
}: LinkedDateFieldShapeProps) {
  const dateSegments = field.date_segments;

  if (!dateSegments || dateSegments.length === 0) {
    // Fallback: shouldn't happen but render nothing if no segments
    return null;
  }

  // Parse the date value into parts
  const dateParts = parseDateValue(value);

  return (
    <Group onClick={onClick} onTap={onClick}>
      {dateSegments.map((segment, index) => {
        // Convert percentage coordinates to pixels
        const x = (segment.left / 100) * pageWidth;
        const y = (segment.top / 100) * pageHeight;
        const width = (segment.width / 100) * pageWidth;
        const height = (segment.height / 100) * pageHeight;

        // Get the value for this segment
        const segmentValue = dateParts ? dateParts[segment.part] : "";

        // Calculate font size
        const fontSize = pageFontSize ?? Math.min(Math.max(height * 0.75, 10), 24);
        const padding = 2;

        // Determine styles
        const bgFill = hideFieldColors ? "transparent" : isActive ? `${COLOR}15` : `${COLOR}08`;
        const strokeColor = isActive ? COLOR : hideFieldColors ? "transparent" : `${COLOR}80`;
        const strokeWidth = isActive ? 1.5 : 1;

        return (
          <Group key={`${field.id}-segment-${index}`}>
            {/* Segment box */}
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

            {/* Segment value */}
            {segmentValue && (
              <Text
                x={x + padding}
                y={y + (height - fontSize) / 2}
                width={width - padding * 2}
                text={segmentValue}
                fontSize={fontSize}
                fill="#374151"
                align="center"
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
