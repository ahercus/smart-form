/**
 * Rectangle Snapping
 *
 * Snaps checkbox/radio fields to small, visually-square PDF vector rectangles,
 * and textarea fields to large rectangles matching Gemini's predicted area.
 *
 * Uses rectangles preserved during PDF vector geometry extraction.
 */

import type { NormalizedCoordinates } from "../types";
import type { VectorRect } from "./types";

// ─── Checkbox Snapping ───────────────────────────────────────────────────────

/**
 * Snap checkbox/radio fields to the nearest small, visually-square vector rectangle.
 *
 * Visual aspect ratio accounts for non-square pages:
 *   visualAR = widthPct / (heightPct * pageAspectRatio)
 * where pageAspectRatio = pageHeight / pageWidth.
 * A visually square box has visualAR ≈ 1.0.
 */
export function applyCheckboxRectSnap<T extends { fieldType: string; coordinates: NormalizedCoordinates }>(
  fields: T[],
  rects: VectorRect[],
  pageAspectRatio: number,
  maxCenterDist = 5.0,
  maxWidthPct = 5.0,
): { fields: T[]; snappedCount: number } {
  // Pre-filter: small, visually-square rectangles
  const checkboxRects = rects.filter((r) => {
    if (r.width > maxWidthPct || r.width < 0.5) return false;
    if (r.height < 0.3) return false;
    const visualAR = r.width / (r.height * pageAspectRatio);
    return visualAR > 0.6 && visualAR < 1.67;
  });

  const checkboxFields = fields.filter((f) => ["checkbox", "radio"].includes(f.fieldType));
  if (checkboxRects.length === 0 || checkboxFields.length === 0) {
    if (checkboxFields.length > 0) {
      console.log("[AutoForm] Checkbox rect snap: no matching PDF rectangles found", {
        totalRects: rects.length,
        checkboxFields: checkboxFields.length,
      });
    }
    return { fields, snappedCount: 0 };
  }

  let snappedCount = 0;

  const snapped = fields.map((field) => {
    if (!["checkbox", "radio"].includes(field.fieldType)) return field;

    const fieldCenterX = field.coordinates.left + field.coordinates.width / 2;
    const fieldCenterY = field.coordinates.top + field.coordinates.height / 2;

    let bestRect: VectorRect | null = null;
    let minDist = maxCenterDist;

    for (const rect of checkboxRects) {
      const rectCenterX = rect.left + rect.width / 2;
      const rectCenterY = rect.top + rect.height / 2;
      const dist = Math.sqrt(
        (fieldCenterX - rectCenterX) ** 2 +
        (fieldCenterY - rectCenterY) ** 2,
      );

      if (dist < minDist) {
        minDist = dist;
        bestRect = rect;
      }
    }

    if (bestRect) {
      snappedCount++;
      return {
        ...field,
        coordinates: {
          left: Number(bestRect.left.toFixed(2)),
          top: Number(bestRect.top.toFixed(2)),
          width: Number(bestRect.width.toFixed(2)),
          height: Number(bestRect.height.toFixed(2)),
        },
      };
    }

    return field;
  });

  return { fields: snapped, snappedCount };
}

// ─── Textarea Snapping ───────────────────────────────────────────────────────

/**
 * Snap textarea fields to the nearest large vector rectangle that
 * roughly matches Gemini's predicted area.
 *
 * Matching criteria:
 * 1. Center-to-center distance < maxCenterDist
 * 2. Area ratio between 0.4 and 2.5
 * 3. Width ratio between 0.5 and 2.0
 */
export function applyTextareaRectSnap<T extends { fieldType: string; coordinates: NormalizedCoordinates }>(
  fields: T[],
  rects: VectorRect[],
  maxCenterDist = 5.0,
  minRectWidth = 10.0,
): { fields: T[]; snappedCount: number } {
  // Pre-filter: large rectangles (textarea candidates)
  const textareaRects = rects.filter((r) => r.width >= minRectWidth && r.height >= 2.0);

  if (textareaRects.length === 0) return { fields, snappedCount: 0 };

  let snappedCount = 0;

  const snapped = fields.map((field) => {
    if (field.fieldType !== "textarea") return field;

    const fieldCenterX = field.coordinates.left + field.coordinates.width / 2;
    const fieldCenterY = field.coordinates.top + field.coordinates.height / 2;
    const fieldArea = field.coordinates.width * field.coordinates.height;

    let bestRect: VectorRect | null = null;
    let minDist = maxCenterDist;

    for (const rect of textareaRects) {
      const rectCenterX = rect.left + rect.width / 2;
      const rectCenterY = rect.top + rect.height / 2;
      const dist = Math.sqrt(
        (fieldCenterX - rectCenterX) ** 2 +
        (fieldCenterY - rectCenterY) ** 2,
      );

      if (dist >= minDist) continue;

      // Area ratio check
      const rectArea = rect.width * rect.height;
      const areaRatio = rectArea / fieldArea;
      if (areaRatio < 0.4 || areaRatio > 2.5) continue;

      // Width ratio check
      const widthRatio = rect.width / field.coordinates.width;
      if (widthRatio < 0.5 || widthRatio > 2.0) continue;

      minDist = dist;
      bestRect = rect;
    }

    if (bestRect) {
      snappedCount++;
      return {
        ...field,
        coordinates: {
          left: Number(bestRect.left.toFixed(2)),
          top: Number(bestRect.top.toFixed(2)),
          width: Number(bestRect.width.toFixed(2)),
          height: Number(bestRect.height.toFixed(2)),
        },
      };
    }

    return field;
  });

  return { fields: snapped, snappedCount };
}
