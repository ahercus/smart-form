/**
 * Quadrant-based field extraction orchestrator
 *
 * Replaces Azure Document Intelligence + cluster-based QC with a simpler approach:
 * - 4 parallel Gemini agents, each assigned a vertical quarter of the page
 * - Each agent sees the full page with a purple overlay highlighting their region
 * - Boundary ownership rules prevent duplicates (ignore upper, own lower)
 * - Optional context agent runs in parallel for form type/subject detection
 *
 * Enable with: USE_QUADRANT_EXTRACTION=true
 * Debug images: Set SAVE_DEBUG_IMAGES=true to save quadrant overlay images
 */

import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Feature flag for saving debug images
const SAVE_DEBUG_IMAGES = process.env.SAVE_DEBUG_IMAGES === "true";
const DEBUG_IMAGES_DIR = join(process.cwd(), "docs/tests/test-debug-images");
import {
  compositeQuadrantOverlay,
  resizeForGemini,
  type QuadrantNumber,
  getQuadrantBounds,
} from "../../image-compositor";
import {
  extractQuadrantFields,
  type RawExtractedField,
} from "../../gemini/vision/quadrant-extract";
import { processExtractedFields } from "./field-processors";
import { quickContextScan, type ContextScanResult } from "../../gemini/vision/context-scan";
import type { ExtractedField, NormalizedCoordinates, ChoiceOption, DateSegment } from "../../types";

/**
 * Deduplicate fields that appear in multiple quadrants due to boundary overlap
 * Fields are considered duplicates if they have the same label and similar coordinates
 */
function deduplicateFields(fields: RawExtractedField[]): RawExtractedField[] {
  const seen = new Map<string, RawExtractedField>();
  const COORD_TOLERANCE = 3; // 3% tolerance for coordinate matching

  for (const field of fields) {
    // Create a key based on label and approximate position
    const approxTop = Math.round(field.coordinates.top / COORD_TOLERANCE) * COORD_TOLERANCE;
    const approxLeft = Math.round(field.coordinates.left / COORD_TOLERANCE) * COORD_TOLERANCE;
    const key = `${field.label}|${field.fieldType}|${approxTop}|${approxLeft}`;

    if (!seen.has(key)) {
      seen.set(key, field);
    }
    // If duplicate, keep the first one (from earlier quadrant)
  }

  return Array.from(seen.values());
}

/**
 * Result from extracting fields from a single page using quadrant approach
 */
export interface PageExtractionResult {
  pageNumber: number;
  fields: ExtractedField[];
  context?: ContextScanResult;
  totalDurationMs: number;
  quadrantDurations: Record<QuadrantNumber, number>;
}

/**
 * Options for quadrant extraction
 */
export interface QuadrantExtractionOptions {
  documentId: string;
  pageNumber: number;
  pageImageBase64: string;
  /** Whether to run context scan in parallel (default: true) */
  includeContextScan?: boolean;
  /** Grid spacing for the overlay (default: 5%) */
  gridSpacing?: number;
}

/**
 * Convert raw extracted field to database-ready ExtractedField
 */
function toExtractedField(
  raw: RawExtractedField,
  documentId: string,
  pageNumber: number,
  fieldIndex: number
): ExtractedField {
  // Convert choice options if present
  const choiceOptions: ChoiceOption[] | null = raw.choiceOptions
    ? raw.choiceOptions.map((opt) => ({
        label: opt.label,
        coordinates: opt.coordinates || { left: 0, top: 0, width: 0, height: 0 },
      }))
    : null;

  return {
    id: randomUUID(),
    document_id: documentId,
    page_number: pageNumber,
    field_index: fieldIndex,
    label: raw.label,
    field_type: raw.fieldType as ExtractedField["field_type"],
    coordinates: raw.coordinates,
    value: null,
    ai_suggested_value: null,
    ai_confidence: null,
    help_text: null,
    detection_source: "gemini_vision",
    confidence_score: null,
    manually_adjusted: false,
    deleted_at: null,
    choice_options: choiceOptions,
    segments: raw.segments || null, // For linkedText fields
    date_segments: raw.dateSegments || null, // For linkedDate fields
    table_config: raw.tableConfig || null, // For table fields
    rows: raw.rows || null, // For textarea fields - number of visible lines
    group_label: raw.groupLabel || null, // Question/header context for this field
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Extract fields from a single page using 4 parallel quadrant agents
 *
 * Flow:
 * 1. Create 4 composite images (one per quadrant with purple overlay)
 * 2. Launch 4 parallel Gemini calls + optional context scan (5 total)
 * 3. Merge results (simple concat - boundary rules prevent duplicates)
 * 4. Return combined fields with IDs assigned
 */
export async function extractFieldsWithQuadrants(
  options: QuadrantExtractionOptions
): Promise<PageExtractionResult> {
  const {
    documentId,
    pageNumber,
    pageImageBase64,
    includeContextScan = true,
    gridSpacing = 5,
  } = options;

  const startTime = Date.now();

  console.log("[AutoForm] Starting quadrant extraction:", {
    documentId: documentId.slice(0, 8),
    pageNumber,
    includeContextScan,
    gridSpacing,
  });

  // Step 0: Resize image to reduce payload and improve Gemini latency
  // Based on partner prototype: max 1600px width, high quality for OCR
  const resized = await resizeForGemini(pageImageBase64, 1600);
  const resizedImageBase64 = resized.imageBase64;

  console.log("[AutoForm] Image resized for Gemini:", {
    pageNumber,
    width: resized.width,
    height: resized.height,
  });

  // Step 1: Create composite images for each quadrant (in parallel)
  const quadrants: QuadrantNumber[] = [1, 2, 3, 4];

  console.log("[AutoForm] Creating quadrant overlay images...");
  const compositePromises = quadrants.map((quadrant) =>
    compositeQuadrantOverlay({
      imageBase64: resizedImageBase64,
      quadrant,
      gridSpacing,
    })
  );

  const compositeResults = await Promise.all(compositePromises);
  const compositeTime = Date.now() - startTime;
  console.log("[AutoForm] Quadrant overlays created:", {
    count: compositeResults.length,
    durationMs: compositeTime,
  });

  // Debug: Save quadrant overlay images for inspection
  if (SAVE_DEBUG_IMAGES) {
    try {
      await mkdir(DEBUG_IMAGES_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      // Save each quadrant image
      for (let i = 0; i < compositeResults.length; i++) {
        const quadrant = quadrants[i];
        const filename = `${timestamp}_doc-${documentId.slice(0, 8)}_page-${pageNumber}_q${quadrant}.png`;
        const filepath = join(DEBUG_IMAGES_DIR, filename);
        await writeFile(filepath, Buffer.from(compositeResults[i].imageBase64, "base64"));
      }

      // Also save the resized original (without overlay) for comparison
      const originalFilename = `${timestamp}_doc-${documentId.slice(0, 8)}_page-${pageNumber}_original.jpg`;
      await writeFile(join(DEBUG_IMAGES_DIR, originalFilename), Buffer.from(resizedImageBase64, "base64"));

      console.log("[AutoForm] Debug images saved to:", DEBUG_IMAGES_DIR);
    } catch (err) {
      console.error("[AutoForm] Failed to save debug images:", err);
    }
  }

  // Step 2: Launch parallel extraction for all quadrants + context scan
  const q1Promise = extractQuadrantFields({
    pageImageBase64: compositeResults[0].imageBase64,
    quadrant: 1,
    pageNumber,
  });
  const q2Promise = extractQuadrantFields({
    pageImageBase64: compositeResults[1].imageBase64,
    quadrant: 2,
    pageNumber,
  });
  const q3Promise = extractQuadrantFields({
    pageImageBase64: compositeResults[2].imageBase64,
    quadrant: 3,
    pageNumber,
  });
  const q4Promise = extractQuadrantFields({
    pageImageBase64: compositeResults[3].imageBase64,
    quadrant: 4,
    pageNumber,
  });

  // Optionally run context scan in parallel
  const contextPromise = includeContextScan
    ? quickContextScan({ pageImageBase64: resizedImageBase64, pageNumber })
    : null;

  console.log("[AutoForm] Launching parallel extraction:", {
    quadrantAgents: 4,
    contextAgent: includeContextScan,
  });

  // Wait for all extractions to complete
  const [q1Result, q2Result, q3Result, q4Result] = await Promise.all([
    q1Promise,
    q2Promise,
    q3Promise,
    q4Promise,
  ]);

  // Wait for context scan if running
  const contextResult = contextPromise ? await contextPromise : null;

  const extractionTime = Date.now() - startTime;
  console.log("[AutoForm] Parallel extraction complete:", {
    durationMs: extractionTime,
    q1Fields: q1Result.fields.length,
    q2Fields: q2Result.fields.length,
    q3Fields: q3Result.fields.length,
    q4Fields: q4Result.fields.length,
    contextResult: contextResult
      ? { formType: contextResult.formType, formSubject: contextResult.formSubject }
      : null,
  });

  // Step 3: Merge all fields from quadrants
  const mergedRawFields: RawExtractedField[] = [
    ...q1Result.fields,
    ...q2Result.fields,
    ...q3Result.fields,
    ...q4Result.fields,
  ];

  // Step 3.5: Deduplicate fields that appear in multiple quadrants (boundary overlap)
  const deduplicatedFields = deduplicateFields(mergedRawFields);

  if (mergedRawFields.length !== deduplicatedFields.length) {
    console.log("[AutoForm] Deduplicated boundary fields:", {
      before: mergedRawFields.length,
      after: deduplicatedFields.length,
      removed: mergedRawFields.length - deduplicatedFields.length,
    });
  }

  // Step 3.6: Process special field types (expand tables, handle linkedText)
  const allRawFields = processExtractedFields(deduplicatedFields);

  // Sort fields by vertical position (top to bottom), then by horizontal position
  allRawFields.sort((a, b) => {
    const topDiff = a.coordinates.top - b.coordinates.top;
    if (Math.abs(topDiff) > 2) return topDiff; // 2% tolerance for same row
    return a.coordinates.left - b.coordinates.left;
  });

  // Step 4: Convert to ExtractedField with IDs
  const fields: ExtractedField[] = allRawFields.map((raw, index) =>
    toExtractedField(raw, documentId, pageNumber, index)
  );

  const totalDurationMs = Date.now() - startTime;

  console.log("[AutoForm] Quadrant extraction complete:", {
    pageNumber,
    totalFields: fields.length,
    totalDurationMs,
    quadrantDurations: {
      1: q1Result.durationMs,
      2: q2Result.durationMs,
      3: q3Result.durationMs,
      4: q4Result.durationMs,
    },
  });

  return {
    pageNumber,
    fields,
    context: contextResult || undefined,
    totalDurationMs,
    quadrantDurations: {
      1: q1Result.durationMs,
      2: q2Result.durationMs,
      3: q3Result.durationMs,
      4: q4Result.durationMs,
    },
  };
}

/**
 * Extract fields from all pages of a document using quadrant approach
 *
 * Processes ALL pages in parallel for maximum speed.
 * Each page runs 4 quadrant agents + 1 context scan (5 Gemini calls).
 * Optional onPageComplete callback enables progressive field reveal.
 */
export async function extractAllPagesWithQuadrants(options: {
  documentId: string;
  pageImages: Array<{ pageNumber: number; imageBase64: string }>;
  /** Callback fired when each page completes (for progressive reveal) */
  onPageComplete?: (result: PageExtractionResult) => Promise<void>;
}): Promise<{
  allFields: ExtractedField[];
  pageResults: PageExtractionResult[];
  totalDurationMs: number;
}> {
  const { documentId, pageImages, onPageComplete } = options;
  const startTime = Date.now();

  console.log("[AutoForm] Starting multi-page PARALLEL quadrant extraction:", {
    documentId: documentId.slice(0, 8),
    pageCount: pageImages.length,
  });

  // Process ALL pages in parallel (no batching)
  const pagePromises = pageImages.map(async (page) => {
    const result = await extractFieldsWithQuadrants({
      documentId,
      pageNumber: page.pageNumber,
      pageImageBase64: page.imageBase64,
    });

    // Fire callback when this page completes (for progressive reveal)
    if (onPageComplete) {
      await onPageComplete(result).catch((err) => {
        console.error("[AutoForm] onPageComplete callback failed:", err);
      });
    }

    return result;
  });

  // Wait for all pages to complete
  const pageResults = await Promise.all(pagePromises);

  // Collect all fields
  const allFields: ExtractedField[] = [];
  for (const result of pageResults) {
    allFields.push(...result.fields);
  }

  // Re-index all fields to ensure unique field_index across pages
  let globalIndex = 0;
  for (const field of allFields) {
    field.field_index = globalIndex++;
  }

  const totalDurationMs = Date.now() - startTime;
  const slowestPage = Math.max(...pageResults.map((r) => r.totalDurationMs));

  console.log("[AutoForm] Multi-page PARALLEL extraction complete:", {
    totalPages: pageImages.length,
    totalFields: allFields.length,
    totalDurationMs,
    slowestPageMs: slowestPage,
    parallelEfficiency: `${Math.round((slowestPage / totalDurationMs) * 100)}%`,
  });

  return {
    allFields,
    pageResults,
    totalDurationMs,
  };
}
