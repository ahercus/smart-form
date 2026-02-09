/**
 * AcroForm Coordinate Snapping
 *
 * Extracts embedded interactive form fields (AcroFields) from PDFs using pdf-lib,
 * Zero-cost fast path: when a PDF contains embedded form field definitions,
 * their coordinates are exact. This bypasses all heuristic snapping.
 * then matches them to Gemini-extracted fields by coordinate overlap (IoU).
 * Matched fields get their coordinates replaced with the mathematically exact
 * AcroForm coordinates.
 *
 * AcroForm fields have perfect coordinates but poor labels (internal names like
 * "field_23"). Gemini has great labels but imprecise coordinates. This module
 * combines the best of both.
 */

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import type { NormalizedCoordinates } from "../types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AcroFormField {
  name: string;
  fieldType: string;
  coordinates: NormalizedCoordinates;
  pageNumber: number; // 1-indexed
}

export interface AcroFormExtractionResult {
  fields: AcroFormField[];
  fieldsByPage: Map<number, AcroFormField[]>;
  hasAcroForm: boolean;
  durationMs: number;
}

export interface AcroFormSnapResult {
  snappedCount: number;
  totalAcroFormFields: number;
  totalGeminiFields: number;
}

// ─── PDF Coordinate Conversion ──────────────────────────────────────────────

/**
 * Convert PDF coordinate space (bottom-left origin, points) to
 * normalized percentages (top-left origin, 0-100).
 */
function pdfToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): NormalizedCoordinates {
  return {
    left: (x / pageWidth) * 100,
    top: ((pageHeight - y - height) / pageHeight) * 100,
    width: (width / pageWidth) * 100,
    height: (height / pageHeight) * 100,
  };
}

// ─── AcroForm Field Helpers ─────────────────────────────────────────────────

function getFieldType(field: PDFDict): string {
  const ft = field.get(PDFName.of("FT"));
  if (!ft) return "unknown";

  const ftStr = (ft as PDFName).decodeText?.() ?? ft.toString();

  switch (ftStr) {
    case "/Tx":
      return "text";
    case "/Btn": {
      const ffVal = getFieldFlags(field);
      if (ffVal & (1 << 15)) return "radio";
      return "checkbox";
    }
    case "/Ch":
      return "text";
    case "/Sig":
      return "signature";
    default:
      return "unknown";
  }
}

function getFieldFlags(field: PDFDict): number {
  const ff = field.get(PDFName.of("Ff"));
  if (ff instanceof PDFNumber) return ff.asNumber();
  return 0;
}

function getFieldName(field: PDFDict): string {
  const t = field.get(PDFName.of("T"));
  if (t instanceof PDFString) return t.decodeText();
  if (t instanceof PDFHexString) return t.decodeText();
  return "";
}

interface WidgetInfo {
  rect: { x: number; y: number; width: number; height: number };
  pageIndex: number;
}

function extractWidgets(
  field: PDFDict,
  pageMap: Map<PDFDict, number>,
): WidgetInfo[] {
  const widgets: WidgetInfo[] = [];
  const kids = field.get(PDFName.of("Kids"));

  const processWidget = (widget: PDFDict) => {
    const rect = widget.get(PDFName.of("Rect"));
    if (!(rect instanceof PDFArray)) return;

    const values: number[] = [];
    for (let i = 0; i < rect.size(); i++) {
      const val = rect.get(i);
      if (val instanceof PDFNumber) values.push(val.asNumber());
    }
    if (values.length !== 4) return;

    const [x1, y1, x2, y2] = values;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    // Skip zero-area widgets
    if (w <= 0 || h <= 0) return;

    const p = widget.get(PDFName.of("P"));
    let pageIndex = 0;
    if (p instanceof PDFDict) {
      pageIndex = pageMap.get(p) ?? 0;
    }

    widgets.push({ rect: { x, y, width: w, height: h }, pageIndex });
  };

  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) {
        processWidget(kid);
      }
    }
  } else {
    processWidget(field);
  }

  return widgets;
}

// ─── AcroForm Extraction ────────────────────────────────────────────────────

/**
 * Extract all AcroForm fields from a PDF buffer.
 * Returns fields grouped by page number for efficient per-page lookup.
 *
 * Should be called ONCE before per-page extraction begins.
 * Cost: ~5-20ms for typical PDFs.
 */
export async function extractAcroFormFields(
  pdfBuffer: Buffer,
): Promise<AcroFormExtractionResult> {
  const start = Date.now();

  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Build page dictionary map for widget-to-page assignment
  const pageMap = new Map<PDFDict, number>();
  for (let i = 0; i < pages.length; i++) {
    pageMap.set(pages[i].node, i);
  }

  // Check for AcroForm dictionary
  const catalog = pdfDoc.context.lookup(
    pdfDoc.context.trailerInfo.Root,
  ) as PDFDict;
  const acroForm = catalog?.get(PDFName.of("AcroForm"));

  if (!acroForm) {
    return {
      fields: [],
      fieldsByPage: new Map(),
      hasAcroForm: false,
      durationMs: Date.now() - start,
    };
  }

  const acroFormDict = pdfDoc.context.lookup(acroForm) as PDFDict;
  const fieldsArray = acroFormDict?.get(PDFName.of("Fields"));

  if (!(fieldsArray instanceof PDFArray) || fieldsArray.size() === 0) {
    return {
      fields: [],
      fieldsByPage: new Map(),
      hasAcroForm: false,
      durationMs: Date.now() - start,
    };
  }

  // Extract all fields
  const fields: AcroFormField[] = [];

  for (let i = 0; i < fieldsArray.size(); i++) {
    const fieldRef = fieldsArray.get(i);
    const field = pdfDoc.context.lookup(fieldRef);
    if (!(field instanceof PDFDict)) continue;

    const name = getFieldName(field);
    const fieldType = getFieldType(field);
    const widgets = extractWidgets(field, pageMap);

    for (const widget of widgets) {
      const page = pages[widget.pageIndex];
      if (!page) continue;

      const { width: pageWidth, height: pageHeight } = page.getSize();
      const coords = pdfToNormalized(
        widget.rect.x,
        widget.rect.y,
        widget.rect.width,
        widget.rect.height,
        pageWidth,
        pageHeight,
      );

      // Skip fields with degenerate coordinates
      if (coords.width <= 0 || coords.height <= 0) continue;

      fields.push({
        name: name || `Field ${i + 1}`,
        fieldType,
        coordinates: coords,
        pageNumber: widget.pageIndex + 1, // 1-indexed
      });
    }
  }

  // Group by page number
  const fieldsByPage = new Map<number, AcroFormField[]>();
  for (const field of fields) {
    const existing = fieldsByPage.get(field.pageNumber) ?? [];
    existing.push(field);
    fieldsByPage.set(field.pageNumber, existing);
  }

  return {
    fields,
    fieldsByPage,
    hasAcroForm: fields.length > 0,
    durationMs: Date.now() - start,
  };
}

// ─── IoU Matching ───────────────────────────────────────────────────────────

function calculateIoU(
  a: NormalizedCoordinates,
  b: NormalizedCoordinates,
): number {
  const intersectLeft = Math.max(a.left, b.left);
  const intersectTop = Math.max(a.top, b.top);
  const intersectRight = Math.min(a.left + a.width, b.left + b.width);
  const intersectBottom = Math.min(a.top + a.height, b.top + b.height);

  if (intersectRight <= intersectLeft || intersectBottom <= intersectTop) {
    return 0;
  }

  const intersectArea =
    (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const unionArea = aArea + bArea - intersectArea;

  return unionArea > 0 ? intersectArea / unionArea : 0;
}

function centerDistance(
  a: NormalizedCoordinates,
  b: NormalizedCoordinates,
): number {
  const aCx = a.left + a.width / 2;
  const aCy = a.top + a.height / 2;
  const bCx = b.left + b.width / 2;
  const bCy = b.top + b.height / 2;
  return Math.sqrt((aCx - bCx) ** 2 + (aCy - bCy) ** 2);
}

// ─── AcroForm Snapping ──────────────────────────────────────────────────────

/** Field types that AcroForm cannot accurately represent */
const SKIP_TYPES = new Set([
  "linkedDate",
  "linkedText",
  "circle_choice",
  "initials",
  "memory_choice",
]);

const IOU_THRESHOLD = 0.15;
const CENTER_DIST_THRESHOLD = 5.0;
const MAX_WIDTH_RATIO = 2.0;

/**
 * Match Gemini fields to AcroForm fields and replace coordinates.
 *
 * For each eligible Gemini field, find the best-matching AcroForm field
 * by IoU (primary) or center distance (fallback). Greedy assignment
 * ensures each AcroForm field matches at most one Gemini field.
 *
 * Complex types (linkedDate, linkedText, etc.) are skipped since
 * AcroForm cannot represent them.
 */
export function applyAcroFormSnap<
  T extends {
    label: string;
    fieldType: string;
    coordinates: NormalizedCoordinates;
  },
>(
  fields: T[],
  acroFormFields: AcroFormField[],
): { fields: T[]; result: AcroFormSnapResult } {
  if (acroFormFields.length === 0) {
    return {
      fields,
      result: {
        snappedCount: 0,
        totalAcroFormFields: 0,
        totalGeminiFields: fields.length,
      },
    };
  }

  // Build scored candidate list
  interface Candidate {
    geminiIdx: number;
    acroIdx: number;
    score: number;
  }
  const candidates: Candidate[] = [];

  for (let gi = 0; gi < fields.length; gi++) {
    const gf = fields[gi];
    if (SKIP_TYPES.has(gf.fieldType)) continue;

    for (let ai = 0; ai < acroFormFields.length; ai++) {
      const af = acroFormFields[ai];

      // Width guard: skip if AcroForm field is much wider than Gemini field
      // (likely includes label area)
      if (
        gf.coordinates.width > 0 &&
        af.coordinates.width / gf.coordinates.width > MAX_WIDTH_RATIO
      ) {
        continue;
      }

      const iou = calculateIoU(gf.coordinates, af.coordinates);
      if (iou >= IOU_THRESHOLD) {
        candidates.push({ geminiIdx: gi, acroIdx: ai, score: iou });
      } else {
        const dist = centerDistance(gf.coordinates, af.coordinates);
        if (dist < CENTER_DIST_THRESHOLD) {
          // Lower score range for distance-based matches
          candidates.push({
            geminiIdx: gi,
            acroIdx: ai,
            score: 0.1 * (1 / (1 + dist)),
          });
        }
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Greedy assignment
  const usedGemini = new Set<number>();
  const usedAcro = new Set<number>();
  const matches: Candidate[] = [];

  for (const c of candidates) {
    if (usedGemini.has(c.geminiIdx) || usedAcro.has(c.acroIdx)) continue;
    matches.push(c);
    usedGemini.add(c.geminiIdx);
    usedAcro.add(c.acroIdx);
  }

  // Apply coordinate replacements
  const result = fields.map((f, i) => {
    const match = matches.find((m) => m.geminiIdx === i);
    if (!match) return f;

    return {
      ...f,
      coordinates: { ...acroFormFields[match.acroIdx].coordinates },
    };
  });

  return {
    fields: result,
    result: {
      snappedCount: matches.length,
      totalAcroFormFields: acroFormFields.length,
      totalGeminiFields: fields.length,
    },
  };
}
