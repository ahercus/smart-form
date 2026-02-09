/**
 * Header Cell Filter
 *
 * Removes fields that are already full of printed text (table headers,
 * section titles, instruction areas misidentified as inputs).
 *
 * Uses OCR word positions to measure text coverage inside each field.
 * Coverage threshold is 25% (raised from 15% after false positives on
 * fields whose labels partially overlap the input area).
 * Header cells like "Siblings Names" are packed with text (high coverage),
 * while empty input cells have near-zero coverage.
 */

import type { NormalizedCoordinates } from "../types";
import type { OcrWordWithCoords } from "./types";

/**
 * Check if an OCR word's center falls inside a field's bounding box.
 */
function isWordInsideField(word: OcrWordWithCoords, field: NormalizedCoordinates): boolean {
  const wordCenterX = word.coords.left + word.coords.width / 2;
  const wordCenterY = word.coords.top + word.coords.height / 2;

  return (
    wordCenterX >= field.left &&
    wordCenterX <= field.left + field.width &&
    wordCenterY >= field.top &&
    wordCenterY <= field.top + field.height
  );
}

/**
 * Removes fields where OCR text covers >25% of the field area,
 * indicating pre-printed text rather than an input field.
 * Must run before table expansion to avoid filtering table header cells.
 */
export function filterPrefilledFields<T extends { fieldType: string; label: string; coordinates: NormalizedCoordinates }>(
  fields: T[],
  ocrWords: OcrWordWithCoords[],
  coverageThreshold = 0.25,
): { fields: T[]; filteredCount: number } {
  if (ocrWords.length === 0) return { fields, filteredCount: 0 };

  let filteredCount = 0;

  const kept = fields.filter((field) => {
    // Only filter text and textarea fields
    if (!["text", "textarea"].includes(field.fieldType)) return true;

    const fieldArea = field.coordinates.width * field.coordinates.height;
    if (fieldArea <= 0) return true;

    // Find OCR words whose center falls inside this field
    const wordsInside = ocrWords.filter((w) => isWordInsideField(w, field.coordinates));

    // Calculate total word area inside the field
    const totalWordArea = wordsInside.reduce(
      (sum, w) => sum + w.coords.width * w.coords.height,
      0,
    );

    const coverage = totalWordArea / fieldArea;

    if (coverage > coverageThreshold) {
      filteredCount++;
      return false;
    }

    return true;
  });

  return { fields: kept, filteredCount };
}
