/**
 * Shared types for the coordinate snapping pipeline
 */

import type { NormalizedCoordinates } from "../types";

/** Horizontal line detected by CV (pixel scan), in percentage coordinates */
export interface LinePct {
  y: number;     // Vertical position (0-100%)
  left: number;  // Left edge (0-100%)
  right: number; // Right edge (0-100%)
  width: number; // Length (0-100%)
}

/** Raw pixel-space line from CV detection */
export interface LinePixel {
  y: number;       // Pixel row
  xStart: number;  // Pixel col start
  xEnd: number;    // Pixel col end
  length: number;  // Pixel length
}

/** Line extracted from PDF vector geometry */
export interface VectorLine {
  x1: number; y1: number; // Start (percentage)
  x2: number; y2: number; // End (percentage)
  isHorizontal: boolean;
  isVertical: boolean;
}

/** Rectangle extracted from PDF vector geometry, in percentage coordinates */
export interface VectorRect {
  left: number;   // Left edge (0-100%)
  top: number;    // Top edge (0-100%)
  width: number;  // Width (0-100%)
  height: number; // Height (0-100%)
}

/** OCR word with normalized coordinates */
export interface OcrWordWithCoords {
  content: string;
  coords: NormalizedCoordinates;
  confidence: number;
}

/** OCR page data stored from Azure Document Intelligence */
export interface OcrPageData {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
  words: Array<{
    content: string;
    polygon: number[];
    confidence: number;
  }>;
}

/** Snapping result with diagnostics */
export interface SnapResult {
  snappedCount: number;
  totalEligible: number;
  cvSnapped: number;
  vectorSnapped: number;
  ocrSnapped: number;
  checkboxRectSnapped: number;
  textareaRectSnapped: number;
  durationMs: number;
}
