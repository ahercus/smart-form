/**
 * CV Line Snapping
 *
 * Detects horizontal lines in page images using pixel-level grayscale analysis,
 * then snaps field bottom edges to the nearest detected line.
 * Complements vector-snap: catches horizontal lines in scanned forms
 * where no PDF vector drawing data exists.
 *
 * +9.8% IoU improvement in benchmarks.
 */

import sharp from "sharp";
import type { NormalizedCoordinates } from "../types";
import type { LinePixel, LinePct } from "./types";

const DEFAULT_OPTIONS = {
  threshold: 200,      // Pixel brightness cutoff (0=black, 255=white)
  minLengthPct: 2,     // Min line length as % of image width
  mergeDistance: 5,     // Pixels: merge lines within this vertical distance
  maxSnapDistPct: 3.0, // Max snap distance in percentage points
};

/**
 * Detect horizontal lines in a page image by scanning for dark pixel runs.
 */
export async function detectHorizontalLines(
  imageBuffer: Buffer,
  options = DEFAULT_OPTIONS,
): Promise<LinePct[]> {
  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const minLineLength = width * (options.minLengthPct / 100);
  const lines: LinePixel[] = [];

  for (let y = 0; y < height; y++) {
    let currentStart = -1;
    let consecutiveDark = 0;

    for (let x = 0; x < width; x++) {
      const pixelValue = data[y * width * channels + x * channels];

      if (pixelValue < options.threshold) {
        if (currentStart === -1) currentStart = x;
        consecutiveDark++;
      } else {
        if (currentStart !== -1 && consecutiveDark > minLineLength) {
          lines.push({ y, xStart: currentStart, xEnd: x, length: consecutiveDark });
        }
        currentStart = -1;
        consecutiveDark = 0;
      }
    }

    if (currentStart !== -1 && consecutiveDark > minLineLength) {
      lines.push({ y, xStart: currentStart, xEnd: width, length: consecutiveDark });
    }
  }

  const merged = mergeNearbyLines(lines, options.mergeDistance);

  // Convert to percentage coordinates
  return merged.map((l) => ({
    y: (l.y / height) * 100,
    left: (l.xStart / width) * 100,
    right: (l.xEnd / width) * 100,
    width: (l.length / width) * 100,
  }));
}

/**
 * Merge lines that are within mergeDistance pixels vertically and overlap horizontally.
 */
function mergeNearbyLines(lines: LinePixel[], mergeDistance: number): LinePixel[] {
  if (lines.length === 0) return [];

  lines.sort((a, b) => a.y - b.y);
  const merged: LinePixel[] = [];
  let current = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    if (
      next.y - current.y < mergeDistance &&
      Math.max(current.xStart, next.xStart) < Math.min(current.xEnd, next.xEnd)
    ) {
      const minX = Math.min(current.xStart, next.xStart);
      const maxX = Math.max(current.xEnd, next.xEnd);
      current = {
        y: Math.round((current.y + next.y) / 2),
        xStart: minX,
        xEnd: maxX,
        length: maxX - minX,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Snap text/date field bottom edges to the nearest detected horizontal line.
 */
export function applyCvSnap<T extends { fieldType: string; coordinates: NormalizedCoordinates }>(
  fields: T[],
  hLines: LinePct[],
  maxSnapDistPct = DEFAULT_OPTIONS.maxSnapDistPct,
): { fields: T[]; snappedCount: number } {
  let snappedCount = 0;

  const snapped = fields.map((field) => {
    if (!["text", "date", "linkedDate"].includes(field.fieldType)) return field;

    const fieldBottom = field.coordinates.top + field.coordinates.height;
    const fieldLeft = field.coordinates.left;
    const fieldRight = fieldLeft + field.coordinates.width;

    let bestLine: LinePct | null = null;
    let minDist = maxSnapDistPct;

    for (const line of hLines) {
      const overlapLeft = Math.max(fieldLeft, line.left);
      const overlapRight = Math.min(fieldRight, line.right);
      if (overlapRight <= overlapLeft) continue;
      if (overlapRight - overlapLeft < field.coordinates.width * 0.5) continue;

      const dist = Math.abs(line.y - fieldBottom);
      if (dist < minDist) {
        minDist = dist;
        bestLine = line;
      }
    }

    if (bestLine) {
      snappedCount++;
      const newTop = bestLine.y - field.coordinates.height;
      let newLeft = field.coordinates.left;
      let newWidth = field.coordinates.width;

      if (Math.abs(bestLine.width - field.coordinates.width) < 8) {
        newLeft = bestLine.left;
        newWidth = bestLine.width;
      }

      return {
        ...field,
        coordinates: {
          left: Number(newLeft.toFixed(2)),
          top: Number(newTop.toFixed(2)),
          width: Number(newWidth.toFixed(2)),
          height: field.coordinates.height,
        },
      };
    }

    return field;
  });

  return { fields: snapped, snappedCount };
}
