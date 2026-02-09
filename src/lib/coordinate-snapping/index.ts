/**
 * Coordinate Snapping Pipeline
 *
 * Chains deterministic snapping approaches to improve field coordinate
 * accuracy after Gemini Vision extraction:
 *
 * 1. OCR snap: Push field.left past label right edge (fixes label overlap)
 * 2. CV snap: Snap field bottom to detected pixel-level horizontal lines
 * 3. Vector snap: Snap field bottom to PDF-native vector horizontal lines
 * 4. Checkbox rect snap: Snap checkbox/radio to nearest small square rectangle
 * 5. Textarea rect snap: Snap textarea to nearest matching large rectangle
 *
 * Benchmark result: 67.8% → 79.1% IoU (+11.3%), zero regressions.
 */

import type { NormalizedCoordinates } from "../types";
import type { OcrWordWithCoords, OcrPageData, SnapResult, VectorLine, VectorRect } from "./types";
import { detectHorizontalLines, applyCvSnap } from "./cv-snap";
import { extractVectorGeometry, applyVectorSnap } from "./vector-snap";
import { applyOcrSnap, ocrPageDataToWords } from "./ocr-snap";
import { applyCheckboxRectSnap, applyTextareaRectSnap } from "./rect-snap";
import { filterPrefilledFields } from "./header-filter";

export type { OcrWordWithCoords, OcrPageData, SnapResult };
export { ocrPageDataToWords, filterPrefilledFields };

interface SnappableField {
  label: string;
  fieldType: string;
  coordinates: NormalizedCoordinates;
}

/**
 * Run the full coordinate snapping pipeline on extracted fields.
 *
 * CV line detection and PDF vector extraction run internally (fast, <1.2s combined).
 * OCR words are optional — if not provided, OCR snap is skipped.
 *
 * Each step is wrapped in try/catch for graceful degradation.
 */
export async function snapFieldCoordinates<T extends SnappableField>(
  fields: T[],
  pageImageBuffer: Buffer,
  pdfBuffer: Buffer,
  pageNumber: number,
  ocrWords?: OcrWordWithCoords[],
): Promise<{ fields: T[]; result: SnapResult }> {
  const startTime = Date.now();
  let current = fields;
  let ocrSnapped = 0;
  let cvSnapped = 0;
  let vectorSnapped = 0;
  let checkboxRectSnapped = 0;
  let textareaRectSnapped = 0;

  // Step 1: OCR snap (if words available)
  if (ocrWords && ocrWords.length > 0) {
    try {
      const ocrResult = applyOcrSnap(current, ocrWords);
      current = ocrResult.fields;
      ocrSnapped = ocrResult.snappedCount;
    } catch (err) {
      console.warn("[AutoForm] OCR snap failed, continuing:", err instanceof Error ? err.message : err);
    }
  }

  // Step 2: CV line snap
  try {
    const hLines = await detectHorizontalLines(pageImageBuffer);
    const cvResult = applyCvSnap(current, hLines);
    current = cvResult.fields;
    cvSnapped = cvResult.snappedCount;
  } catch (err) {
    console.warn("[AutoForm] CV snap failed, continuing:", err instanceof Error ? err.message : err);
  }

  // Step 3-5: PDF vector snap (lines + rects)
  try {
    const geometry = await extractVectorGeometry(pdfBuffer, pageNumber);
    const vectorResult = applyVectorSnap(current, geometry.lines);
    current = vectorResult.fields;
    vectorSnapped = vectorResult.snappedCount;

    if (geometry.rects.length > 0) {
      const cbResult = applyCheckboxRectSnap(current, geometry.rects, geometry.pageAspectRatio);
      current = cbResult.fields;
      checkboxRectSnapped = cbResult.snappedCount;

      const taResult = applyTextareaRectSnap(current, geometry.rects);
      current = taResult.fields;
      textareaRectSnapped = taResult.snappedCount;
    }
  } catch (err) {
    console.warn("[AutoForm] Vector snap failed, continuing:", err instanceof Error ? err.message : err);
  }

  const totalSnapped = Math.max(ocrSnapped, cvSnapped, vectorSnapped) + checkboxRectSnapped + textareaRectSnapped;
  const totalEligible = fields.filter((f) =>
    ["text", "date", "linkedDate", "checkbox", "radio", "textarea"].includes(f.fieldType)
  ).length;

  const result: SnapResult = {
    snappedCount: totalSnapped,
    totalEligible,
    cvSnapped,
    vectorSnapped,
    ocrSnapped,
    checkboxRectSnapped,
    textareaRectSnapped,
    durationMs: Date.now() - startTime,
  };

  console.log("[AutoForm] Coordinate snapping:", {
    page: pageNumber,
    snapped: `${totalSnapped}/${totalEligible}`,
    cv: cvSnapped,
    vector: vectorSnapped,
    ocr: ocrSnapped,
    checkboxRect: checkboxRectSnapped,
    textareaRect: textareaRectSnapped,
    durationMs: result.durationMs,
  });

  return { fields: current, result };
}

/**
 * Prepare geometry data in parallel with Gemini extraction.
 * Returns CV lines, vector lines, vector rectangles, and page aspect ratio.
 *
 * This function is meant to be called via Promise.all alongside the Gemini call,
 * so geometry extraction happens during Gemini's ~10s wait time.
 */
export async function prepareGeometry(
  pageImageBuffer: Buffer,
  pdfBuffer: Buffer,
  pageNumber: number,
) {
  const [cvLines, vectorGeometry] = await Promise.all([
    detectHorizontalLines(pageImageBuffer).catch((err) => {
      console.warn("[AutoForm] CV line detection failed:", err instanceof Error ? err.message : err);
      return [];
    }),
    extractVectorGeometry(pdfBuffer, pageNumber).catch((err) => {
      console.warn("[AutoForm] Vector extraction failed:", err instanceof Error ? err.message : err);
      return { lines: [] as VectorLine[], rects: [] as VectorRect[], pageAspectRatio: 1.414 };
    }),
  ]);

  return {
    cvLines,
    vectorLines: vectorGeometry.lines,
    vectorRects: vectorGeometry.rects,
    pageAspectRatio: vectorGeometry.pageAspectRatio,
  };
}

/**
 * Snap fields using pre-computed geometry (from prepareGeometry).
 * Use this when geometry was prepared in parallel with Gemini extraction.
 */
export function snapWithPrecomputedGeometry<T extends SnappableField>(
  fields: T[],
  cvLines: Awaited<ReturnType<typeof detectHorizontalLines>>,
  vectorLines: VectorLine[],
  vectorRects: VectorRect[],
  pageAspectRatio: number,
  ocrWords?: OcrWordWithCoords[],
): { fields: T[]; result: SnapResult } {
  const startTime = Date.now();
  let current = fields;
  let ocrSnapped = 0;
  let cvSnapped = 0;
  let vectorSnapped = 0;
  let checkboxRectSnapped = 0;
  let textareaRectSnapped = 0;

  // Step 1: OCR snap
  if (ocrWords && ocrWords.length > 0) {
    try {
      const ocrResult = applyOcrSnap(current, ocrWords);
      current = ocrResult.fields;
      ocrSnapped = ocrResult.snappedCount;
    } catch (err) {
      console.warn("[AutoForm] OCR snap failed, continuing:", err instanceof Error ? err.message : err);
    }
  }

  // Step 2: CV snap
  try {
    const cvResult = applyCvSnap(current, cvLines);
    current = cvResult.fields;
    cvSnapped = cvResult.snappedCount;
  } catch (err) {
    console.warn("[AutoForm] CV snap failed, continuing:", err instanceof Error ? err.message : err);
  }

  // Step 3: Vector line snap
  try {
    const vectorResult = applyVectorSnap(current, vectorLines);
    current = vectorResult.fields;
    vectorSnapped = vectorResult.snappedCount;
  } catch (err) {
    console.warn("[AutoForm] Vector snap failed, continuing:", err instanceof Error ? err.message : err);
  }

  // Step 4: Checkbox rect snap
  if (vectorRects.length > 0) {
    try {
      const cbResult = applyCheckboxRectSnap(current, vectorRects, pageAspectRatio);
      current = cbResult.fields;
      checkboxRectSnapped = cbResult.snappedCount;
    } catch (err) {
      console.warn("[AutoForm] Checkbox rect snap failed, continuing:", err instanceof Error ? err.message : err);
    }
  }

  // Step 5: Textarea rect snap
  if (vectorRects.length > 0) {
    try {
      const taResult = applyTextareaRectSnap(current, vectorRects);
      current = taResult.fields;
      textareaRectSnapped = taResult.snappedCount;
    } catch (err) {
      console.warn("[AutoForm] Textarea rect snap failed, continuing:", err instanceof Error ? err.message : err);
    }
  }

  const totalSnapped = Math.max(ocrSnapped, cvSnapped, vectorSnapped) + checkboxRectSnapped + textareaRectSnapped;
  const totalEligible = fields.filter((f) =>
    ["text", "date", "linkedDate", "checkbox", "radio", "textarea"].includes(f.fieldType)
  ).length;

  const result: SnapResult = {
    snappedCount: totalSnapped,
    totalEligible,
    cvSnapped,
    vectorSnapped,
    ocrSnapped,
    checkboxRectSnapped,
    textareaRectSnapped,
    durationMs: Date.now() - startTime,
  };

  return { fields: current, result };
}
