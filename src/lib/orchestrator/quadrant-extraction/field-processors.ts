/**
 * Field processors for quadrant extraction
 *
 * Handles special field types that need transformation after extraction:
 * - table: Expands compact table definition into N×M individual text fields
 * - linkedText: Keeps as single field but ensures segments are preserved
 */

import type { RawExtractedField, TableConfig } from "../../gemini/vision/quadrant-extract";
import type { NormalizedCoordinates } from "../../types";

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
  });

  return processed;
}
