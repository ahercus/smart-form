/**
 * Single-page field extraction orchestrator
 *
 * Simplified extraction pipeline:
 * 1. Resize image for Gemini (max 1600px width)
 * 2. Single Gemini Flash call with full_rails_no_rulers prompt
 * 3. Process special fields (expand tables, handle linkedDate)
 * 4. Return fields ready for database insertion
 *
 * ~10 seconds per page, 1 API call per page
 * (vs old quadrant system: ~40 seconds, 5 API calls)
 */

import { resizeForGemini } from "../../image-compositor";
import { extractFieldsFromPage, normalizeCoordinateScale, type RawExtractedField } from "../../gemini/vision/single-page-extract";
import type { NormalizedCoordinates, DateSegment, FieldType, TableConfig, ChoiceOption } from "../../types";
import { prepareGeometry, snapWithPrecomputedGeometry, filterPrefilledFields } from "../../coordinate-snapping";
import type { OcrWordWithCoords, AcroFormField } from "../../coordinate-snapping";
import type { VectorLine } from "../../coordinate-snapping/types";

// Standard page aspect ratio (height / width) for checkbox adjustment
// Most forms are Letter (11/8.5 = 1.29) or A4 (297/210 = 1.414)
const PAGE_ASPECT_RATIO = 1.414;

export interface PageExtractionResult {
  pageNumber: number;
  fields: ProcessedField[];
  durationMs: number;
}

export interface ProcessedField {
  label: string;
  fieldType: FieldType;
  coordinates: NormalizedCoordinates;
  groupLabel?: string | null;
  rows?: number | null;
  tableConfig?: TableConfig | null;
  dateSegments?: DateSegment[] | null;
  segments?: NormalizedCoordinates[] | null;
  choiceOptions?: ChoiceOption[] | null;
  fromTableExpansion?: boolean;
}

export interface ExtractionOptions {
  documentId: string;
  pageNumber: number;
  imageBase64: string;
  pdfBuffer?: Buffer;
  ocrWords?: OcrWordWithCoords[];
  acroFormFields?: AcroFormField[];
  onProgress?: (message: string) => void;
}

export interface MultiPageExtractionOptions {
  documentId: string;
  pageImages: Array<{ pageNumber: number; imageBase64: string }>;
  pdfBuffer?: Buffer;
  ocrWordsByPage?: Map<number, OcrWordWithCoords[]>;
  acroFormFieldsByPage?: Map<number, AcroFormField[]>;
  onPageComplete?: (result: PageExtractionResult) => void;
  onProgress?: (message: string) => void;
}

/**
 * Extract fields from a single page using parallel Gemini + geometry processing.
 * Orchestrates: resize → parallel(Gemini, geometry) → filter → snap → expand.
 * Returns fields ready for database insertion.
 */
export async function extractFieldsFromSinglePage(
  options: ExtractionOptions
): Promise<PageExtractionResult> {
  const { pageNumber, imageBase64, pdfBuffer, ocrWords, onProgress } = options;

  onProgress?.(`Processing page ${pageNumber}...`);

  // Step 1: Resize image for Gemini
  let resized: { imageBase64: string; width: number; height: number };
  try {
    resized = await resizeForGemini(imageBase64, 1600);
    onProgress?.(`Resized to ${resized.width}x${resized.height}`);
  } catch (err) {
    console.error(`[AutoForm] Page ${pageNumber} FAILED at step 1 (resize):`, err);
    throw err;
  }

  // Step 2: Run Gemini extraction + geometry prep in parallel
  let extraction: Awaited<ReturnType<typeof extractFieldsFromPage>>;
  let geometry: Awaited<ReturnType<typeof prepareGeometry>> | null = null;
  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const geometryPromise = pdfBuffer
      ? prepareGeometry(imageBuffer, pdfBuffer, pageNumber)
      : null;

    [extraction, geometry] = await Promise.all([
      extractFieldsFromPage(resized.imageBase64),
      geometryPromise,
    ]);
    console.log(`[AutoForm] Page ${pageNumber} step 2 (Gemini+geometry) OK: ${extraction.fields.length} raw fields`);
  } catch (err) {
    console.error(`[AutoForm] Page ${pageNumber} FAILED at step 2 (Gemini+geometry):`, err);
    throw err;
  }

  // Step 2.5: Normalize coordinate scale (calibrated against PDF vector geometry)
  const normalizedExtractionFields = normalizeCoordinateScale(
    extraction.fields,
    geometry?.vectorLines,
  );

  // Step 3: Filter out prefilled text
  let rawFields = normalizedExtractionFields;
  try {
    if (ocrWords && ocrWords.length > 0) {
      const filterResult = filterPrefilledFields(rawFields, ocrWords);
      if (filterResult.filteredCount > 0) {
        console.log("[AutoForm] Filtered prefilled fields:", {
          page: pageNumber,
          removed: filterResult.filteredCount,
          remaining: filterResult.fields.length,
        });
        rawFields = filterResult.fields;
      }
    }
  } catch (err) {
    console.error(`[AutoForm] Page ${pageNumber} FAILED at step 3 (filter prefilled):`, err);
    throw err;
  }

  // Step 4: Process special fields (tables, linkedDate, checkboxes)
  let processedFields: ProcessedField[];
  try {
    const vectorLines = geometry?.vectorLines;
    processedFields = processExtractedFields(rawFields, vectorLines);
    onProgress?.(`Processed to ${processedFields.length} fields`);
  } catch (err) {
    console.error(`[AutoForm] Page ${pageNumber} FAILED at step 4 (process fields):`, err);
    throw err;
  }

  // Step 5: Apply coordinate snapping
  if (geometry) {
    try {
      const snapResult = snapWithPrecomputedGeometry(
        processedFields,
        geometry.cvLines,
        geometry.vectorLines,
        geometry.vectorRects,
        geometry.pageAspectRatio,
        ocrWords,
        options.acroFormFields,
      );

      console.log("[AutoForm] Coordinate snapping:", {
        page: pageNumber,
        snapped: `${snapResult.result.snappedCount}/${snapResult.result.totalEligible}`,
        acroForm: snapResult.result.acroFormSnapped,
        cv: snapResult.result.cvSnapped,
        vector: snapResult.result.vectorSnapped,
        ocr: snapResult.result.ocrSnapped,
        checkboxRect: snapResult.result.checkboxRectSnapped,
        textareaRect: snapResult.result.textareaRectSnapped,
        vectorRects: geometry.vectorRects.length,
        vectorLines: geometry.vectorLines.length,
        durationMs: snapResult.result.durationMs,
      });

      return {
        pageNumber,
        fields: snapResult.fields,
        durationMs: extraction.durationMs,
      };
    } catch (err) {
      console.error(`[AutoForm] Page ${pageNumber} FAILED at step 5 (coordinate snapping):`, err);
      throw err;
    }
  }

  return {
    pageNumber,
    fields: processedFields,
    durationMs: extraction.durationMs,
  };
}

/**
 * Extract fields from all pages, processing pages in parallel.
 * Each page runs its own Gemini + geometry pipeline concurrently.
 */
export async function extractFieldsFromAllPages(
  options: MultiPageExtractionOptions
): Promise<PageExtractionResult[]> {
  const { pageImages, pdfBuffer, ocrWordsByPage, acroFormFieldsByPage, onPageComplete, onProgress } = options;

  onProgress?.(`Starting extraction for ${pageImages.length} pages...`);

  // Process all pages in parallel, isolating failures per page
  const settled = await Promise.allSettled(
    pageImages.map(async ({ pageNumber, imageBase64 }) => {
      const result = await extractFieldsFromSinglePage({
        documentId: options.documentId,
        pageNumber,
        imageBase64,
        pdfBuffer,
        ocrWords: ocrWordsByPage?.get(pageNumber),
        acroFormFields: acroFormFieldsByPage?.get(pageNumber),
        onProgress: (msg) => onProgress?.(`[Page ${pageNumber}] ${msg}`),
      });

      onPageComplete?.(result);
      return result;
    })
  );

  // Collect successful results and track failures for retry
  const results: PageExtractionResult[] = [];
  const failedPages: Array<{ pageNumber: number; imageBase64: string; error: unknown }> = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const pageNumber = pageImages[i].pageNumber;
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      console.error(`[AutoForm] Page ${pageNumber} extraction FAILED:`, outcome.reason);
      failedPages.push({ pageNumber, imageBase64: pageImages[i].imageBase64, error: outcome.reason });
    }
  }

  // Retry failed pages sequentially (rate-limit/timeout recovery)
  for (const { pageNumber, imageBase64, error } of failedPages) {
    console.log(`[AutoForm] Retrying page ${pageNumber} extraction (original error: ${error instanceof Error ? error.message : error})`);
    try {
      const result = await extractFieldsFromSinglePage({
        documentId: options.documentId,
        pageNumber,
        imageBase64,
        pdfBuffer,
        ocrWords: ocrWordsByPage?.get(pageNumber),
        acroFormFields: acroFormFieldsByPage?.get(pageNumber),
        onProgress: (msg) => onProgress?.(`[Page ${pageNumber} retry] ${msg}`),
      });
      onPageComplete?.(result);
      results.push(result);
      console.log(`[AutoForm] Page ${pageNumber} retry succeeded: ${result.fields.length} fields`);
    } catch (retryErr) {
      console.error(`[AutoForm] Page ${pageNumber} retry also FAILED:`, retryErr);
      results.push({ pageNumber, fields: [], durationMs: 0 });
    }
  }

  // Sort by page number
  results.sort((a, b) => a.pageNumber - b.pageNumber);

  const totalFields = results.reduce((sum, r) => sum + r.fields.length, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  onProgress?.(`Extraction complete: ${totalFields} fields across ${pageImages.length} pages in ${totalDuration}ms`);

  return results;
}

/**
 * Process all extracted fields, expanding tables and handling special types
 */
function processExtractedFields(fields: RawExtractedField[], vectorLines?: VectorLine[]): ProcessedField[] {
  const processed: ProcessedField[] = [];

  for (const field of fields) {
    switch (field.fieldType) {
      case "table":
        // Expand table into individual cell fields, snapping columns to vector lines
        const expandedCells = expandTableToFields(field, vectorLines);
        processed.push(...expandedCells);
        break;

      case "linkedText":
        // Process linkedText to preserve segments
        processed.push(processLinkedTextField(field));
        break;

      case "linkedDate":
        // Process linkedDate to preserve dateSegments
        processed.push(processLinkedDateField(field));
        break;

      case "checkbox":
      case "radio":
        // Adjust height for visual square rendering
        processed.push(processCheckboxField(field));
        break;

      default:
        // Pass through other field types
        processed.push(normalizeField(field));
        break;
    }
  }

  console.log("[AutoForm] Field processing complete:", {
    inputCount: fields.length,
    outputCount: processed.length,
    tablesExpanded: fields.filter((f) => f.fieldType === "table").length,
  });

  return processed;
}

/**
 * Normalize a raw field to ProcessedField format
 */
function normalizeField(field: RawExtractedField): ProcessedField {
  return {
    label: field.label,
    fieldType: normalizeFieldType(field.fieldType),
    coordinates: field.coordinates,
    groupLabel: field.groupLabel ?? null,
    rows: field.rows ?? null,
    tableConfig: null,
    choiceOptions: field.choiceOptions ?? null,
    dateSegments: null,
    segments: field.segments ?? null,
  };
}

/**
 * Normalize field type to valid FieldType
 */
function normalizeFieldType(type: string): FieldType {
  const validTypes: FieldType[] = [
    "text", "textarea", "checkbox", "radio", "date",
    "signature", "initials", "memory_choice", "circle_choice",
    "linkedDate", "unknown"
  ];

  // Handle linkedText -> text (stored as text with segments)
  if (type === "linkedText") return "text";

  // Handle linkedDate -> date (stored as date with dateSegments)
  if (type === "linkedDate") return "date";

  // Handle table -> text (tables are expanded to individual cells)
  if (type === "table") return "text";

  if (validTypes.includes(type as FieldType)) {
    return type as FieldType;
  }

  console.warn(`[AutoForm] Unknown field type "${type}", defaulting to "text"`);
  return "text";
}

/**
 * Expand a table field into individual cell fields.
 * If vector lines are available, snaps column boundaries to actual PDF grid lines.
 */
function expandTableToFields(tableField: RawExtractedField, vectorLines?: VectorLine[]): ProcessedField[] {
  const config = tableField.tableConfig;
  if (!config) {
    console.warn("[AutoForm] Table field missing tableConfig:", tableField.label);
    return [];
  }

  const { columnHeaders, dataRows, columnPositions, rowHeights } = config;
  // Use tableConfig.coordinates if present, otherwise fall back to field's coordinates
  const coordinates = config.coordinates || tableField.coordinates;

  if (!coordinates) {
    console.warn("[AutoForm] Table field missing coordinates:", tableField.label);
    return [];
  }

  const numColumns = columnHeaders?.length || 0;

  if (numColumns === 0 || !dataRows || dataRows === 0) {
    console.warn("[AutoForm] Table has no columns or rows:", { columnHeaders, dataRows });
    return [];
  }

  // Snap table bounding box and column boundaries to vector lines if available
  const snapped = snapTableToVectorLines(coordinates, numColumns, columnPositions, vectorLines);

  const colWidths = calculateWidthsFromPositions(snapped.colPositions);

  // Calculate row heights (or use uniform)
  const rowHeightValues = rowHeights || Array(dataRows).fill(100 / dataRows);

  const expandedFields: ProcessedField[] = [];
  let currentTop = snapped.coordinates.top;

  for (let row = 0; row < dataRows; row++) {
    const rowHeight = (rowHeightValues[row] / 100) * snapped.coordinates.height;

    for (let col = 0; col < numColumns; col++) {
      const colStart = snapped.colPositions[col];
      const colWidth = colWidths[col];

      const cellLeft = snapped.coordinates.left + (colStart / 100) * snapped.coordinates.width;
      const cellWidth = (colWidth / 100) * snapped.coordinates.width;

      expandedFields.push({
        label: `${columnHeaders[col]} - Row ${row + 1}`,
        fieldType: "text",
        coordinates: {
          left: cellLeft,
          top: currentTop,
          width: cellWidth,
          height: rowHeight,
        },
        groupLabel: tableField.groupLabel ?? tableField.label,
        rows: null,
        tableConfig: null,
        dateSegments: null,
        segments: null,
        fromTableExpansion: true,
      });
    }

    currentTop += rowHeight;
  }

  console.log("[AutoForm] Expanded table:", {
    label: tableField.label,
    columns: numColumns,
    rows: dataRows,
    totalFields: expandedFields.length,
    vectorSnapped: snapped.snappedColumns > 0,
    snappedColumns: snapped.snappedColumns,
  });

  return expandedFields;
}

/**
 * Snap table bounding box and column positions to vertical PDF vector lines.
 *
 * Finds vertical lines within the table's Y range, clusters them (PDF tables
 * often draw the same line twice at slightly different x), then maps each
 * Gemini-estimated column boundary to the nearest cluster.
 */
function snapTableToVectorLines(
  coordinates: NormalizedCoordinates,
  numColumns: number,
  columnPositions: number[] | undefined,
  vectorLines?: VectorLine[],
): { coordinates: NormalizedCoordinates; colPositions: number[]; snappedColumns: number } {
  const geminiColPositions = columnPositions || generateUniformPositions(numColumns);

  if (!vectorLines || vectorLines.length === 0) {
    return { coordinates, colPositions: geminiColPositions, snappedColumns: 0 };
  }

  // Find vertical lines that overlap with the table's vertical range
  const tableTop = coordinates.top;
  const tableBottom = coordinates.top + coordinates.height;
  const tableLeft = coordinates.left;
  const tableRight = coordinates.left + coordinates.width;

  const vLines = vectorLines.filter((l) => {
    if (!l.isVertical) return false;
    // Line must overlap with table's Y range (at least 30% overlap)
    const lineTop = Math.min(l.y1, l.y2);
    const lineBottom = Math.max(l.y1, l.y2);
    const overlapTop = Math.max(tableTop, lineTop);
    const overlapBottom = Math.min(tableBottom, lineBottom);
    const overlap = overlapBottom - overlapTop;
    if (overlap <= 0) return false;
    const lineHeight = lineBottom - lineTop;
    if (lineHeight <= 0) return false;
    // Line must be within extended table X range (allow 5% margin)
    const lineX = l.x1;
    return lineX >= tableLeft - 5 && lineX <= tableRight + 5;
  });

  if (vLines.length === 0) {
    return { coordinates, colPositions: geminiColPositions, snappedColumns: 0 };
  }

  // Cluster nearby vertical lines (within 1.5% of each other)
  const xPositions = vLines.map((l) => l.x1).sort((a, b) => a - b);
  const clusters: number[] = [];
  let clusterSum = xPositions[0];
  let clusterCount = 1;

  for (let i = 1; i < xPositions.length; i++) {
    if (xPositions[i] - xPositions[i - 1] < 1.5) {
      clusterSum += xPositions[i];
      clusterCount++;
    } else {
      clusters.push(clusterSum / clusterCount);
      clusterSum = xPositions[i];
      clusterCount = 1;
    }
  }
  clusters.push(clusterSum / clusterCount);

  // We need numColumns + 1 boundaries (left edge, N-1 dividers, right edge)
  // Convert Gemini's relative column positions to absolute x for matching
  const geminiAbsolutePositions = geminiColPositions.map(
    (p) => coordinates.left + (p / 100) * coordinates.width
  );

  // Snap each Gemini column boundary to the nearest vector cluster
  const maxSnapDist = 5; // max 5% snap distance
  let snappedColumns = 0;
  const snappedAbsolute = geminiAbsolutePositions.map((geminiX) => {
    let bestCluster: number | null = null;
    let bestDist = maxSnapDist;
    for (const cx of clusters) {
      const dist = Math.abs(cx - geminiX);
      if (dist < bestDist) {
        bestDist = dist;
        bestCluster = cx;
      }
    }
    if (bestCluster !== null) {
      snappedColumns++;
      return bestCluster;
    }
    return geminiX;
  });

  // Derive snapped coordinates and relative column positions
  const snappedLeft = snappedAbsolute[0];
  const snappedRight = snappedAbsolute[snappedAbsolute.length - 1];
  const snappedWidth = snappedRight - snappedLeft;

  const snappedColPositions = snappedAbsolute.map((absX) =>
    snappedWidth > 0 ? ((absX - snappedLeft) / snappedWidth) * 100 : 0
  );

  const snappedCoordinates: NormalizedCoordinates = {
    left: snappedLeft,
    top: coordinates.top,
    width: snappedWidth,
    height: coordinates.height,
  };

  console.log("[AutoForm] Table column snap:", {
    geminiEdges: geminiAbsolutePositions.map((x) => x.toFixed(1)),
    vectorClusters: clusters.map((x) => x.toFixed(1)),
    snappedEdges: snappedAbsolute.map((x) => x.toFixed(1)),
    snappedColumns,
  });

  return { coordinates: snappedCoordinates, colPositions: snappedColPositions, snappedColumns };
}

/**
 * Generate uniform column positions for N columns
 */
function generateUniformPositions(numColumns: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i <= numColumns; i++) {
    positions.push((i / numColumns) * 100);
  }
  return positions;
}

/**
 * Calculate column widths from position boundaries
 */
function calculateWidthsFromPositions(positions: number[]): number[] {
  const widths: number[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    widths.push(positions[i + 1] - positions[i]);
  }
  return widths;
}

/**
 * Process linkedText field to preserve segments
 */
function processLinkedTextField(field: RawExtractedField): ProcessedField {
  if (!field.segments || field.segments.length === 0) {
    console.warn("[AutoForm] LinkedText field missing segments:", field.label);
    return normalizeField(field);
  }

  // Use bounding box of all segments as main coordinates
  const boundingBox = calculateBoundingBox(field.segments);

  return {
    label: field.label,
    fieldType: "text", // Store as text with segments
    coordinates: boundingBox,
    groupLabel: field.groupLabel ?? null,
    rows: null,
    tableConfig: null,
    dateSegments: null,
    segments: field.segments,
  };
}

/**
 * Process linkedDate field to preserve dateSegments
 */
function processLinkedDateField(field: RawExtractedField): ProcessedField {
  if (!field.dateSegments || field.dateSegments.length === 0) {
    console.warn("[AutoForm] LinkedDate field missing dateSegments:", field.label);
    return {
      ...normalizeField(field),
      fieldType: "date",
    };
  }

  // Use bounding box of all segments as main coordinates
  const boundingBox = calculateBoundingBox(field.dateSegments);

  return {
    label: field.label,
    fieldType: "date", // Store as date with dateSegments
    coordinates: boundingBox,
    groupLabel: field.groupLabel ?? null,
    rows: null,
    tableConfig: null,
    dateSegments: field.dateSegments,
    segments: null,
  };
}

/**
 * Process checkbox to ensure visual square rendering
 */
function processCheckboxField(field: RawExtractedField): ProcessedField {
  const { coordinates } = field;

  // Adjust height for visual square on non-square page
  const adjustedHeight = coordinates.width / PAGE_ASPECT_RATIO;

  return {
    label: field.label,
    fieldType: field.fieldType as FieldType,
    coordinates: {
      ...coordinates,
      height: adjustedHeight,
    },
    groupLabel: field.groupLabel ?? null,
    rows: null,
    tableConfig: null,
    dateSegments: null,
    segments: null,
  };
}

/**
 * Calculate bounding box for an array of segments
 */
function calculateBoundingBox(segments: NormalizedCoordinates[]): NormalizedCoordinates {
  if (segments.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const seg of segments) {
    minLeft = Math.min(minLeft, seg.left);
    minTop = Math.min(minTop, seg.top);
    maxRight = Math.max(maxRight, seg.left + seg.width);
    maxBottom = Math.max(maxBottom, seg.top + seg.height);
  }

  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}
