import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import sharp from "sharp";

const execAsync = promisify(exec);

const pdfPath = process.argv[2];
const outputDirArg = process.argv[3] || "docs/tests/output/azure-di";

if (!pdfPath) {
  throw new Error("Usage: node scripts/render-azure-di-overlays.mjs /path/to/file.pdf [outputDir]");
}

const outputDir = path.resolve(outputDirArg);
await fs.mkdir(outputDir, { recursive: true });

const pageImagePath = path.join(outputDir, "page-1.png");

async function ensurePageImage() {
  try {
    await fs.access(pageImagePath);
    return;
  } catch {
    // continue to create
  }

  const tmpPrefix = path.join(outputDir, "page");
  try {
    await execAsync(`pdftoppm -png -f 1 -l 1 -r 150 "${pdfPath}" "${tmpPrefix}"`);
  } catch (error) {
    try {
      await execAsync(`convert -density 150 "${pdfPath}[0]" "${pageImagePath}"`);
      return;
    } catch {
      throw new Error(
        "Could not convert PDF to PNG. Install pdftoppm (poppler) or ImageMagick."
      );
    }
  }

  const pdftoppmOutput = `${tmpPrefix}-1.png`;
  try {
    await fs.rename(pdftoppmOutput, pageImagePath);
  } catch {
    // If rename fails, fallback to copy
    const data = await fs.readFile(pdftoppmOutput);
    await fs.writeFile(pageImagePath, data);
  }
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

function getFieldColor(fieldType) {
  switch (fieldType) {
    case "text":
      return "#3b82f6";
    case "textarea":
      return "#8b5cf6";
    case "date":
      return "#f59e0b";
    case "checkbox":
      return "#10b981";
    case "radio":
      return "#06b6d4";
    case "signature":
      return "#ef4444";
    case "initials":
      return "#ec4899";
    case "circle_choice":
      return "#f97316";
    default:
      return "#6b7280";
  }
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createOverlaySvg(width, height, fields, showGrid, gridSpacing) {
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  if (showGrid) {
    svg += `<g stroke="#999999" stroke-width="0.5" opacity="0.4">`;
    for (let x = 0; x <= 100; x += gridSpacing) {
      if (x % 25 !== 0) {
        const px = (x / 100) * width;
        svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
      }
    }
    for (let y = 0; y <= 100; y += gridSpacing) {
      if (y % 25 !== 0) {
        const py = (y / 100) * height;
        svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
      }
    }
    svg += `</g>`;

    svg += `<g stroke="#666666" stroke-width="1" opacity="0.6">`;
    for (let x = 0; x <= 100; x += 25) {
      const px = (x / 100) * width;
      svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
    }
    for (let y = 0; y <= 100; y += 25) {
      const py = (y / 100) * height;
      svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
    }
    svg += `</g>`;

    svg += `<g font-family="Arial, sans-serif" fill="#000000">`;
    for (let y = 0; y <= 100; y += 10) {
      const py = (y / 100) * height;
      const isMajor = y % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      svg += `<rect x="0" y="${py}" width="24" height="14" fill="white" opacity="0.8"/>`;
      svg += `<text x="2" y="${py + 11}" font-size="${fontSize}" font-weight="${fontWeight}">${y}</text>`;
    }
    for (let x = 10; x <= 100; x += 10) {
      const px = (x / 100) * width;
      const isMajor = x % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      svg += `<rect x="${px - 12}" y="0" width="24" height="14" fill="white" opacity="0.8"/>`;
      svg += `<text x="${px - 10}" y="11" font-size="${fontSize}" font-weight="${fontWeight}">${x}</text>`;
    }
    svg += `</g>`;
  }

  for (const field of fields) {
    const coords = field.coordinates;
    const x = (coords.left / 100) * width;
    const y = (coords.top / 100) * height;
    const w = (coords.width / 100) * width;
    const h = (coords.height / 100) * height;

    const color = getFieldColor(field.field_type);
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}20" stroke="${color}" stroke-width="2" />`;

    const labelY = Math.max(y - 5, 12);
    svg += `<text x="${x}" y="${labelY}" font-size="10" font-family="Arial, sans-serif" fill="${color}" font-weight="bold">${escapeXml(field.label)}</text>`;
    svg += `<text x="${x + 2}" y="${y + 12}" font-size="8" font-family="monospace" fill="#666666">${field.id.slice(0, 8)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

async function compositeFieldsOntoImage(imageBase64, fields, showGrid = true, gridSpacing = 10) {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  const overlaySvg = createOverlaySvg(width, height, fields, showGrid, gridSpacing);
  const overlayBuffer = Buffer.from(overlaySvg);

  const composited = await sharp(imageBuffer)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return composited.toString("base64");
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
      document_id: "azure-run",
      page_number: pageNumber,
      field_index: fieldIndex,
      label: keyContent,
      field_type: inferFieldType(keyContent, valueContent),
      coordinates,
      value: isCheckbox ? (isSelectedValue(valueContent) ? "true" : null) : null,
      ai_suggested_value: isCheckbox ? null : valueContent,
      ai_confidence: kvp.confidence,
      help_text: null,
      detection_source: "azure_document_intelligence",
      confidence_score: kvp.confidence,
      manually_adjusted: false,
      deleted_at: null,
      choice_options: null,
      segments: null,
      date_segments: null,
      group_label: null,
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
        document_id: "azure-run",
        page_number: page.pageNumber,
        field_index: selectionMarkIndex++,
        label: `Checkbox ${selectionMarkIndex}`,
        field_type: "checkbox",
        coordinates,
        value: selectionMark.state === "selected" ? "true" : null,
        ai_suggested_value: null,
        ai_confidence: selectionMark.confidence,
        help_text: null,
        detection_source: "azure_document_intelligence",
        confidence_score: selectionMark.confidence,
        manually_adjusted: false,
        deleted_at: null,
        choice_options: null,
        segments: null,
        date_segments: null,
        group_label: null,
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
        document_id: "azure-run",
        page_number: tablePageNumber,
        field_index: tableFieldIndex++,
        label,
        field_type: hasSelectionMark ? "checkbox" : "text",
        coordinates,
        value: hasSelectionMark ? (isSelectedValue(cellContent) ? "true" : null) : null,
        ai_suggested_value: isEmpty || hasSelectionMark ? null : cellContent,
        ai_confidence: cellConfidence,
        help_text: null,
        detection_source: "azure_document_intelligence",
        confidence_score: cellConfidence,
        manually_adjusted: false,
        deleted_at: null,
        choice_options: null,
        segments: null,
        date_segments: null,
        group_label: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return fields.filter((f) => f.page_number === 1);
}

await ensurePageImage();
const pageImageBuffer = await fs.readFile(pageImagePath);
const pageImageBase64 = pageImageBuffer.toString("base64");

const jsonFiles = (await fs.readdir(outputDir))
  .filter((name) => name.endsWith(".json") && name.includes("prep_questionnaire_page1_run_"))
  .sort();

if (jsonFiles.length === 0) {
  throw new Error(`No Azure DI JSON files found in ${outputDir}`);
}

for (const jsonFile of jsonFiles) {
  const jsonPath = path.join(outputDir, jsonFile);
  const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const fields = extractFieldsFromAnalyzeResult(raw);
  const compositedBase64 = await compositeFieldsOntoImage(pageImageBase64, fields, true, 10);
  const outPath = path.join(
    outputDir,
    jsonFile.replace(".json", "_render.png")
  );
  await fs.writeFile(outPath, Buffer.from(compositedBase64, "base64"));
  console.log(`Rendered ${jsonFile} -> ${path.relative(process.cwd(), outPath)}`);
}
