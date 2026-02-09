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
import { extractFieldsFromPage, type RawExtractedField } from "../../gemini/vision/single-page-extract";
import type { NormalizedCoordinates, DateSegment, FieldType, TableConfig } from "../../types";
import { prepareGeometry, snapWithPrecomputedGeometry, filterPrefilledFields } from "../../coordinate-snapping";
import type { OcrWordWithCoords, AcroFormField } from "../../coordinate-snapping";

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
 * Extract fields from a single page
 */
export async function extractFieldsFromSinglePage(
  options: ExtractionOptions
): Promise<PageExtractionResult> {
  const { pageNumber, imageBase64, pdfBuffer, ocrWords, onProgress } = options;

  onProgress?.(`Processing page ${pageNumber}...`);

  // Step 1: Resize image for Gemini
  const resized = await resizeForGemini(imageBase64, 1600);
  onProgress?.(`Resized to ${resized.width}x${resized.height}`);

  // Step 2: Run Gemini extraction + geometry prep in parallel
  // Gemini takes ~10s; CV detection (~200ms) and vector extraction (~1s) run during that wait
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const geometryPromise = pdfBuffer
    ? prepareGeometry(imageBuffer, pdfBuffer, pageNumber)
    : null;

  const [extraction, geometry] = await Promise.all([
    extractFieldsFromPage(resized.imageBase64),
    geometryPromise,
  ]);
  onProgress?.(`Extracted ${extraction.fields.length} raw fields`);

  // Step 3: Filter out prefilled text BEFORE table expansion
  // Must run before processExtractedFields so table cells (which are "text" after
  // expansion) aren't incorrectly filtered by OCR text from the header row.
  // Table fields have fieldType "table" and are naturally skipped by the filter.
  let rawFields = extraction.fields;
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

  // Step 3.5: Process special fields (tables, linkedDate, checkboxes)
  let processedFields = processExtractedFields(rawFields);
  onProgress?.(`Processed to ${processedFields.length} fields`);

  // Step 4: Apply coordinate snapping (AcroForm → OCR → CV → Vector → Checkbox rect → Textarea rect)
  if (geometry) {
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
      durationMs: snapResult.result.durationMs,
    });

    return {
      pageNumber,
      fields: snapResult.fields,
      durationMs: extraction.durationMs,
    };
  }

  return {
    pageNumber,
    fields: processedFields,
    durationMs: extraction.durationMs,
  };
}

/**
 * Extract fields from multiple pages in parallel
 */
export async function extractFieldsFromAllPages(
  options: MultiPageExtractionOptions
): Promise<PageExtractionResult[]> {
  const { pageImages, pdfBuffer, ocrWordsByPage, acroFormFieldsByPage, onPageComplete, onProgress } = options;

  onProgress?.(`Starting extraction for ${pageImages.length} pages...`);

  // Process all pages in parallel
  const results = await Promise.all(
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
function processExtractedFields(fields: RawExtractedField[]): ProcessedField[] {
  const processed: ProcessedField[] = [];

  for (const field of fields) {
    switch (field.fieldType) {
      case "table":
        // Expand table into individual cell fields
        const expandedCells = expandTableToFields(field);
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
 * Expand a table field into individual cell fields
 */
function expandTableToFields(tableField: RawExtractedField): ProcessedField[] {
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

  // Calculate column widths from positions (or use uniform)
  const colPositions = columnPositions || generateUniformPositions(numColumns);
  const colWidths = calculateWidthsFromPositions(colPositions);

  // Calculate row heights (or use uniform)
  const rowHeightValues = rowHeights || Array(dataRows).fill(100 / dataRows);

  const expandedFields: ProcessedField[] = [];
  let currentTop = coordinates.top;

  for (let row = 0; row < dataRows; row++) {
    const rowHeight = (rowHeightValues[row] / 100) * coordinates.height;

    for (let col = 0; col < numColumns; col++) {
      const colStart = colPositions[col];
      const colWidth = colWidths[col];

      const cellLeft = coordinates.left + (colStart / 100) * coordinates.width;
      const cellWidth = (colWidth / 100) * coordinates.width;

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
  });

  return expandedFields;
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
