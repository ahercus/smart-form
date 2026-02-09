/**
 * OCR Anchor Snapping
 *
 * Matches Gemini field labels to Azure OCR word-level positions, then
 * pushes the field's left edge past the label's right edge to fix
 * Most conservative snap in the pipeline: only adjusts the left coordinate.
 * Labels are the most reliable OCR anchor for horizontal positioning.
 * Gemini's tendency to overlap labels with input areas.
 *
 * Conservative: only snaps LEFT boundary, only inline text fields.
 * +3.5% IoU improvement in benchmarks (adds ~1% on top of CV/Vector).
 */

import type { NormalizedCoordinates } from "../types";
import type { OcrWordWithCoords, OcrPageData } from "./types";

// ─── OCR Data Conversion ────────────────────────────────────────────────────

/**
 * Convert Azure OCR page data into OcrWordWithCoords for a specific page.
 */
export function ocrPageDataToWords(pageData: OcrPageData): OcrWordWithCoords[] {
  const words: OcrWordWithCoords[] = [];
  for (const word of pageData.words) {
    if (word.polygon.length < 8) continue;
    const xs = [word.polygon[0], word.polygon[2], word.polygon[4], word.polygon[6]];
    const ys = [word.polygon[1], word.polygon[3], word.polygon[5], word.polygon[7]];
    words.push({
      content: word.content,
      coords: {
        left: (Math.min(...xs) / pageData.width) * 100,
        top: (Math.min(...ys) / pageData.height) * 100,
        width: ((Math.max(...xs) - Math.min(...xs)) / pageData.width) * 100,
        height: ((Math.max(...ys) - Math.min(...ys)) / pageData.height) * 100,
      },
      confidence: word.confidence,
    });
  }
  return words;
}

// ─── Label Matching ─────────────────────────────────────────────────────────

interface LabelMatch {
  label: string;
  matchedWords: OcrWordWithCoords[];
  labelCoords: NormalizedCoordinates;
  confidence: number;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[^\w\s'/-]/g, "").trim();
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}

function boundingBoxOfWords(words: OcrWordWithCoords[]): NormalizedCoordinates {
  if (words.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (const w of words) {
    minL = Math.min(minL, w.coords.left);
    minT = Math.min(minT, w.coords.top);
    maxR = Math.max(maxR, w.coords.left + w.coords.width);
    maxB = Math.max(maxB, w.coords.top + w.coords.height);
  }
  return { left: minL, top: minT, width: maxR - minL, height: maxB - minT };
}

function coordDistance(a: NormalizedCoordinates, b: NormalizedCoordinates): number {
  return Math.sqrt(
    (a.left + a.width / 2 - (b.left + b.width / 2)) ** 2 +
    (a.top + a.height / 2 - (b.top + b.height / 2)) ** 2,
  );
}

function matchLabelToOcrWords(
  label: string,
  words: OcrWordWithCoords[],
  fieldCoords: NormalizedCoordinates,
): LabelMatch | null {
  const normLabel = normalizeText(label);
  const labelTokens = normLabel.split(/\s+/).filter(Boolean);
  if (labelTokens.length === 0) return null;

  type Candidate = { startIdx: number; endIdx: number; score: number };
  const candidates: Candidate[] = [];

  // Sliding window: consecutive words matching label tokens
  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    let matchedTokens = 0;
    let endIdx = startIdx;
    let tokenIdx = 0;

    while (endIdx < words.length && tokenIdx < labelTokens.length) {
      const wordNorm = normalizeText(words[endIdx].content);
      if (wordNorm === labelTokens[tokenIdx]) {
        matchedTokens++; tokenIdx++; endIdx++;
      } else if (labelTokens[tokenIdx].includes(wordNorm) || wordNorm.includes(labelTokens[tokenIdx])) {
        matchedTokens += 0.8; tokenIdx++; endIdx++;
      } else {
        break;
      }
    }

    if (matchedTokens >= labelTokens.length * 0.6) {
      const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
      const proximity = 1 / (1 + coordDistance(matchedBox, fieldCoords));
      candidates.push({ startIdx, endIdx, score: 0.6 * (matchedTokens / labelTokens.length) + 0.4 * proximity });
    }
  }

  // Also try joining consecutive words and comparing full string similarity
  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    for (let windowSize = 1; windowSize <= Math.min(labelTokens.length + 2, words.length - startIdx); windowSize++) {
      const endIdx = startIdx + windowSize;
      const joinedWords = words.slice(startIdx, endIdx).map((w) => normalizeText(w.content)).join(" ");
      const similarity = stringSimilarity(normLabel, joinedWords);
      if (similarity > 0.7) {
        const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
        const proximity = 1 / (1 + coordDistance(matchedBox, fieldCoords));
        if (!candidates.some((c) => c.startIdx === startIdx && c.endIdx === endIdx)) {
          candidates.push({ startIdx, endIdx, score: 0.5 * similarity + 0.5 * proximity });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const matchedWords = words.slice(best.startIdx, best.endIdx);
  return { label, matchedWords, labelCoords: boundingBoxOfWords(matchedWords), confidence: best.score };
}

// ─── Snapping ───────────────────────────────────────────────────────────────

/**
 * Apply OCR-based left-boundary snapping to fields.
 *
 * Safety rules:
 * 1. Only snap inline text fields (not textarea, checkbox, table, linkedDate, date)
 * 2. Label must be shorter than the field (label doesn't extend past field right edge)
 * 3. Shift amount must be < 10%
 * 4. Resulting width must be ≥ 60% of original
 */
export function applyOcrSnap<T extends { label: string; fieldType: string; coordinates: NormalizedCoordinates }>(
  fields: T[],
  ocrWords: OcrWordWithCoords[],
): { fields: T[]; snappedCount: number } {
  if (ocrWords.length === 0) return { fields, snappedCount: 0 };

  // Match all labels first
  const labelMatches = new Map<number, LabelMatch>();
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const match = matchLabelToOcrWords(field.label, ocrWords, field.coordinates);
    if (match) labelMatches.set(i, match);
  }

  let snappedCount = 0;

  const snapped = fields.map((field, i) => {
    const match = labelMatches.get(i);
    if (!match) return field;

    // Only snap text fields (not checkbox, table, linkedDate, textarea, date)
    if (!["text"].includes(field.fieldType)) return field;

    const labelBox = match.labelCoords;
    const coords = field.coordinates;
    const labelRight = labelBox.left + labelBox.width;
    const fieldRight = coords.left + coords.width;

    const isSameLine = Math.abs(labelBox.top - coords.top) < 3;
    const labelShorterThanField = labelRight < fieldRight - 2;
    const isOverlapping = coords.left < labelRight;
    const shiftAmount = labelRight - coords.left;

    if (isSameLine && isOverlapping && labelShorterThanField && shiftAmount > 0 && shiftAmount < 10) {
      const newLeft = labelRight;
      const newWidth = fieldRight - newLeft;

      if (newWidth < coords.width * 0.6) return field;
      if (newLeft < 0 || newLeft + newWidth > 100 || newWidth < 2) return field;

      snappedCount++;
      return {
        ...field,
        coordinates: {
          left: Number(newLeft.toFixed(2)),
          top: coords.top,
          width: Number(newWidth.toFixed(2)),
          height: coords.height,
        },
      };
    }

    return field;
  });

  return { fields: snapped, snappedCount };
}
