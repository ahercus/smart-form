import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: node scripts/azure-di-extract-page1-fields.mjs /path/to/raw.json /path/to/output.json"
  );
}

function polygonToCoordinates(polygon, pageWidth, pageHeight, isKeyRegion = false) {
  if (!polygon || polygon.length < 8) {
    return { left: 0, top: 0, width: 10, height: 4 };
  }

  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  let left = (minX / pageWidth) * 100;
  let top = (minY / pageHeight) * 100;
  let width = ((maxX - minX) / pageWidth) * 100;
  let height = ((maxY - minY) / pageHeight) * 100;

  if (isKeyRegion) {
    const labelHeight = height;
    top = top + labelHeight + 0.5;
    height = Math.max(3, labelHeight * 1.5);
    width = Math.max(width, 15);
  }

  return { left, top, width, height };
}

function isSelectionMarkValue(value) {
  if (!value) return false;
  return (
    value === ":selected:" ||
    value === ":unselected:" ||
    value === "☒" ||
    value === "☐" ||
    value === ":selected" ||
    value === ":unselected"
  );
}

function isSelectedValue(value) {
  if (!value) return false;
  return value === ":selected:" || value === ":selected" || value === "☒";
}

function inferFieldType(fieldName, fieldValue) {
  const name = fieldName.toLowerCase();

  if (name.includes("signature")) return "signature";
  if (name.includes("date") || name.includes("dob") || name.includes("birth")) return "date";

  if (
    isSelectionMarkValue(fieldValue) ||
    name.includes("checkbox") ||
    name.includes("agree") ||
    name.includes("consent")
  ) {
    return "checkbox";
  }

  if (
    name.includes("comment") ||
    name.includes("note") ||
    name.includes("description") ||
    name.includes("address")
  ) {
    return "textarea";
  }

  return "text";
}

function extractFieldsFromAnalyzeResult(result) {
  const analyzeResult = result?.analyzeResult;
  if (!analyzeResult) {
    throw new Error("Missing analyzeResult in Azure response");
  }

  const pageDimensions = {};
  for (const page of analyzeResult.pages || []) {
    pageDimensions[page.pageNumber] = { width: page.width, height: page.height };
  }

  const fields = [];
  const now = new Date().toISOString();

  (analyzeResult.keyValuePairs || []).forEach((kvp, fieldIndex) => {
    const keyContent = kvp.key?.content?.trim() || `Field ${fieldIndex + 1}`;
    const valueContent = kvp.value?.content?.trim() || null;

    const keyRegions = kvp.key?.boundingRegions || [];
    const valueRegions = kvp.value?.boundingRegions || [];
    const pageNumber = keyRegions[0]?.pageNumber || valueRegions[0]?.pageNumber || 1;

    const pageDim = pageDimensions[pageNumber] || { width: 8.5, height: 11 };
    const hasValueRegion = valueRegions.length > 0 && valueRegions[0]?.polygon;
    const polygon = hasValueRegion ? valueRegions[0].polygon : keyRegions[0]?.polygon;
    const coordinates = polygonToCoordinates(polygon, pageDim.width, pageDim.height, !hasValueRegion);

    const isCheckbox = isSelectionMarkValue(valueContent);

    fields.push({
      id: crypto.randomUUID(),
      page_number: pageNumber,
      field_index: fieldIndex,
      label: keyContent,
      field_type: inferFieldType(keyContent, valueContent),
      coordinates,
      value: isCheckbox ? (isSelectedValue(valueContent) ? "true" : null) : null,
      ai_suggested_value: isCheckbox ? null : valueContent,
      ai_confidence: kvp.confidence,
      detection_source: "azure_document_intelligence",
      created_at: now,
      updated_at: now,
    });
  });

  const extractedCoords = new Set(
    fields.map((f) => `${f.page_number}-${Math.round(f.coordinates.left)}-${Math.round(f.coordinates.top)}`)
  );

  let selectionMarkIndex = fields.length;
  for (const page of analyzeResult.pages || []) {
    const pageDim = pageDimensions[page.pageNumber] || { width: 8.5, height: 11 };
    for (const selectionMark of page.selectionMarks || []) {
      const coordinates = polygonToCoordinates(
        selectionMark.polygon,
        pageDim.width,
        pageDim.height,
        false
      );

      const coordKey = `${page.pageNumber}-${Math.round(coordinates.left)}-${Math.round(coordinates.top)}`;
      if (extractedCoords.has(coordKey)) {
        continue;
      }
      extractedCoords.add(coordKey);

      fields.push({
        id: crypto.randomUUID(),
        page_number: page.pageNumber,
        field_index: selectionMarkIndex++,
        label: `Checkbox ${selectionMarkIndex}`,
        field_type: "checkbox",
        coordinates,
        value: selectionMark.state === "selected" ? "true" : null,
        ai_suggested_value: null,
        ai_confidence: selectionMark.confidence,
        detection_source: "azure_document_intelligence",
        created_at: now,
        updated_at: now,
      });
    }
  }

  let tableFieldIndex = fields.length;
  for (const table of analyzeResult.tables || []) {
    const tablePageNumber = table.boundingRegions?.[0]?.pageNumber || 1;
    const pageDim = pageDimensions[tablePageNumber] || { width: 8.5, height: 11 };

    const headers = {};
    for (const cell of table.cells || []) {
      if (cell.kind === "columnHeader") {
        headers[cell.columnIndex] = cell.content.trim();
      }
    }

    for (const cell of table.cells || []) {
      if (cell.kind === "columnHeader" || cell.kind === "rowHeader" || cell.kind === "stubHead") {
        continue;
      }

      if (!cell.boundingRegions?.[0]) {
        continue;
      }

      const cellContent = cell.content.trim();
      const coordinates = polygonToCoordinates(
        cell.boundingRegions[0].polygon,
        pageDim.width,
        pageDim.height,
        false
      );

      const coordKey = `${tablePageNumber}-${Math.round(coordinates.left)}-${Math.round(coordinates.top)}`;
      if (extractedCoords.has(coordKey)) {
        continue;
      }

      const isEmpty = !cellContent || cellContent === "(empty)";
      const hasSelectionMark = isSelectionMarkValue(cellContent);
      const looksLikeInput = isEmpty || hasSelectionMark || cellContent.length < 3;

      if (!looksLikeInput) {
        continue;
      }

      extractedCoords.add(coordKey);

      const columnHeader = headers[cell.columnIndex];
      const label = columnHeader || `Table Field R${cell.rowIndex + 1}C${cell.columnIndex + 1}`;
      const cellConfidence = cell.confidence ?? 0.8;

      fields.push({
        id: crypto.randomUUID(),
        page_number: tablePageNumber,
        field_index: tableFieldIndex++,
        label,
        field_type: hasSelectionMark ? "checkbox" : "text",
        coordinates,
        value: hasSelectionMark ? (isSelectedValue(cellContent) ? "true" : null) : null,
        ai_suggested_value: isEmpty || hasSelectionMark ? null : cellContent,
        ai_confidence: cellConfidence,
        detection_source: "azure_document_intelligence",
        created_at: now,
        updated_at: now,
      });
    }
  }

  return fields.filter((f) => f.page_number === 1);
}

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const fields = extractFieldsFromAnalyzeResult(raw);

const output = {
  source: path.basename(inputPath),
  page: 1,
  field_count: fields.length,
  fields,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
