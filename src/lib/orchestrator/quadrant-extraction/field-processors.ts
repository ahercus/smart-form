/**
 * Field processors for quadrant extraction
 *
 * Handles special field types that need transformation after extraction:
 * - table: Expands compact table definition into N×M individual text fields
 * - linkedText: Keeps as single field but ensures segments are preserved
 */

import type { RawExtractedField, TableConfig } from "../../gemini/vision/quadrant-extract";
import type { NormalizedCoordinates, DateSegment } from "../../types";

/**
 * Standard page aspect ratio (height / width)
 * Most forms are Letter (11/8.5 = 1.29) or A4 (297/210 = 1.414)
 * Using A4 ratio as it's close to common PDF renders
 */
const PAGE_ASPECT_RATIO = 1.414;

/**
 * Expand a table field into individual cell fields
 *
 * Given a table definition like:
 * {
 *   columnHeaders: ["Name", "Age"],
 *   coordinates: { left: 5, top: 35, width: 90, height: 20 },
 *   dataRows: 3,
 *   columnPositions: [0, 60, 100]  // Name=60%, Age=40%
 * }
 *
 * Expands to 6 text fields:
 * - "Name - Row 1" at { left: 5, top: 35, width: 54, height: 6.67 }
 * - "Age - Row 1" at { left: 59, top: 35, width: 36, height: 6.67 }
 * - etc.
 */
export function expandTableToFields(
  tableField: RawExtractedField
): RawExtractedField[] {
  const config = tableField.tableConfig;
  if (!config) {
    console.warn("[AutoForm] Table field missing tableConfig, skipping expansion:", tableField.label);
    return [];
  }

  const { columnHeaders, coordinates, dataRows, columnPositions, rowHeights } = config;
  const numColumns = columnHeaders.length;

  if (numColumns === 0 || dataRows === 0) {
    console.warn("[AutoForm] Table has no columns or rows:", { columnHeaders, dataRows });
    return [];
  }

  // Calculate column widths from positions (or use uniform)
  const colPositions = columnPositions || generateUniformPositions(numColumns);
  const colWidths = calculateWidthsFromPositions(colPositions);

  // Calculate row heights (or use uniform)
  const rowHeightValues = rowHeights || Array(dataRows).fill(100 / dataRows);

  const expandedFields: RawExtractedField[] = [];

  let currentTop = coordinates.top;

  for (let row = 0; row < dataRows; row++) {
    const rowHeight = (rowHeightValues[row] / 100) * coordinates.height;

    for (let col = 0; col < numColumns; col++) {
      const colStart = colPositions[col];
      const colWidth = colWidths[col];

      // Calculate absolute coordinates
      const cellLeft = coordinates.left + (colStart / 100) * coordinates.width;
      const cellWidth = (colWidth / 100) * coordinates.width;

      const cellField: RawExtractedField = {
        label: `${columnHeaders[col]} - Row ${row + 1}`,
        fieldType: "text",
        coordinates: {
          left: cellLeft,
          top: currentTop,
          width: cellWidth,
          height: rowHeight,
        },
      };

      expandedFields.push(cellField);
    }

    currentTop += rowHeight;
  }

  console.log("[AutoForm] Expanded table to fields:", {
    originalLabel: tableField.label,
    columns: numColumns,
    rows: dataRows,
    totalFields: expandedFields.length,
  });

  return expandedFields;
}

/**
 * Generate uniform column positions for N columns
 * Returns array like [0, 33.33, 66.67, 100] for 3 columns
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
 * [0, 60, 100] → [60, 40]
 */
function calculateWidthsFromPositions(positions: number[]): number[] {
  const widths: number[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    widths.push(positions[i + 1] - positions[i]);
  }
  return widths;
}

/**
 * Process linkedText field to ensure segments are properly set
 * LinkedText fields stay as single field but need the segments array preserved
 */
export function processLinkedTextField(field: RawExtractedField): RawExtractedField {
  if (!field.segments || field.segments.length === 0) {
    console.warn("[AutoForm] LinkedText field missing segments, using coordinates as single segment:", field.label);
    return {
      ...field,
      fieldType: "text", // Convert to regular text
      segments: [field.coordinates],
    };
  }

  // Use the bounding box of all segments as the main coordinates
  const boundingBox = calculateBoundingBox(field.segments);

  return {
    ...field,
    fieldType: "text", // Store as text type - segments make it linkedText
    coordinates: boundingBox,
    segments: field.segments,
  };
}

/**
 * Process linkedDate field to ensure dateSegments are properly set
 * LinkedDate fields are stored as `date` type with `dateSegments` array
 * (database constraint only allows: text, textarea, checkbox, radio, date, signature, initials, circle_choice, unknown)
 */
export function processLinkedDateField(field: RawExtractedField): RawExtractedField {
  if (!field.dateSegments || field.dateSegments.length === 0) {
    console.warn("[AutoForm] LinkedDate field missing dateSegments, converting to regular date:", field.label);
    return {
      ...field,
      fieldType: "date", // Convert to regular date
    };
  }

  // Use the bounding box of all date segments as the main coordinates
  const boundingBox = calculateBoundingBox(field.dateSegments);

  return {
    ...field,
    fieldType: "date", // Store as date type - dateSegments make it a segmented date
    coordinates: boundingBox,
    dateSegments: field.dateSegments,
  };
}

/**
 * Process checkbox field to ensure it renders as a visual square
 *
 * Since coordinates are percentages on a non-square page:
 * - 1% width ≠ 1% height visually
 * - To get a visual square: height% = width% / PAGE_ASPECT_RATIO
 *
 * We trust the width measurement (LLM reads horizontal ruler) and adjust height accordingly.
 */
export function processCheckboxField(field: RawExtractedField): RawExtractedField {
  const { coordinates } = field;

  // Calculate the height percentage that will render as visually square
  // If width is 2.2%, on A4 (ratio 1.414), height should be 2.2 / 1.414 ≈ 1.56%
  const adjustedHeight = coordinates.width / PAGE_ASPECT_RATIO;

  return {
    ...field,
    coordinates: {
      ...coordinates,
      height: adjustedHeight,
    },
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

/**
 * Process all extracted fields, expanding tables and handling linkedText
 *
 * Call this after merging quadrant results but before converting to ExtractedField
 */
export function processExtractedFields(fields: RawExtractedField[]): RawExtractedField[] {
  const processed: RawExtractedField[] = [];

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
        // Adjust height for visual square rendering on non-square pages
        processed.push(processCheckboxField(field));
        break;

      default:
        // Pass through other field types unchanged
        processed.push(field);
        break;
    }
  }

  console.log("[AutoForm] Field processing complete:", {
    inputCount: fields.length,
    outputCount: processed.length,
    tablesExpanded: fields.filter((f) => f.fieldType === "table").length,
    linkedTextProcessed: fields.filter((f) => f.fieldType === "linkedText").length,
    linkedDateProcessed: fields.filter((f) => f.fieldType === "linkedDate").length,
  });

  return processed;
}
