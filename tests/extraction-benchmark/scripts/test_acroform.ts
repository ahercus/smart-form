#!/usr/bin/env npx tsx
/**
 * Script 1: AcroForm Extraction Test
 *
 * Extracts embedded interactive form fields (AcroFields) from PDFs using pdf-lib.
 * These fields have mathematically exact coordinates defined in the PDF spec.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_acroform.ts
 */

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString, PDFHexString } from "pdf-lib";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  loadBenchmark,
  loadTestPdf,
  saveResults,
  scoreFields,
  printScore,
  PATHS,
  type BenchmarkField,
  type Coordinates,
} from "./test_utils";

// ─── Coordinate Conversion ──────────────────────────────────────────────────

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
  pageHeight: number
): Coordinates {
  return {
    left: (x / pageWidth) * 100,
    top: ((pageHeight - y - height) / pageHeight) * 100,
    width: (width / pageWidth) * 100,
    height: (height / pageHeight) * 100,
  };
}

// ─── AcroForm Field Type Mapping ────────────────────────────────────────────

function getFieldType(field: PDFDict): string {
  // FT entry: /Tx (text), /Btn (button/checkbox/radio), /Ch (choice), /Sig (signature)
  const ft = field.get(PDFName.of("FT"));
  if (!ft) return "unknown";

  const ftStr = (ft as PDFName).decodeText?.() ?? ft.toString();

  switch (ftStr) {
    case "/Tx":
      return "text";
    case "/Btn": {
      // Distinguish checkbox vs radio via Ff flags
      const ffVal = getFieldFlags(field);
      if (ffVal & (1 << 15)) return "radio"; // bit 16 = radio
      return "checkbox";
    }
    case "/Ch":
      return "text"; // Dropdown/listbox → treat as text
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

// ─── Widget Rectangle Extraction ────────────────────────────────────────────

interface WidgetInfo {
  rect: { x: number; y: number; width: number; height: number };
  pageIndex: number;
}

function extractWidgets(field: PDFDict, pageMap: Map<PDFDict, number>): WidgetInfo[] {
  const widgets: WidgetInfo[] = [];

  // A field can have its own widget annotation (if Kids is absent)
  // or multiple widgets under Kids
  const kids = field.get(PDFName.of("Kids"));

  const processWidget = (widget: PDFDict) => {
    const rect = widget.get(PDFName.of("Rect"));
    if (!(rect instanceof PDFArray)) return;

    const values = [];
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

    // Determine which page this widget belongs to
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
    // Field IS the widget
    processWidget(field);
  }

  return widgets;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[AutoForm] Script 1: AcroForm Extraction Test\n");

  const pdfBuffer = loadTestPdf();
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  console.log(`PDF: ${pages.length} page(s)`);

  // Build page dictionary map for widget-to-page assignment
  const pageMap = new Map<PDFDict, number>();
  for (let i = 0; i < pages.length; i++) {
    pageMap.set(pages[i].node, i);
  }

  // Try the high-level API first
  let hasForm = false;
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    console.log(`AcroForm fields found: ${fields.length}`);
    hasForm = fields.length > 0;

    if (hasForm) {
      for (const field of fields) {
        console.log(`  - "${field.getName()}" (${field.constructor.name})`);
      }
    }
  } catch {
    console.log("No AcroForm found (getForm() threw).");
  }

  // Also try low-level extraction for more detail
  const catalog = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Root) as PDFDict;
  const acroForm = catalog?.get(PDFName.of("AcroForm"));

  if (!acroForm) {
    console.log("\nNo AcroForm dictionary in PDF catalog.");
    console.log("This PDF has no embedded interactive form fields.");
    console.log("AcroForm extraction would not help for this document.\n");

    // Still score an empty result to show the baseline
    const benchmark = loadBenchmark();
    const emptyScore = scoreFields([], benchmark.fields);
    printScore("AcroForm (no fields found)", emptyScore);

    // Try other test PDFs
    await testOtherPdfs(pageMap);
    return;
  }

  const acroFormDict = pdfDoc.context.lookup(acroForm) as PDFDict;
  const fieldsArray = acroFormDict?.get(PDFName.of("Fields"));

  if (!(fieldsArray instanceof PDFArray)) {
    console.log("\nAcroForm exists but Fields array is missing or empty.");
    return;
  }

  console.log(`\nLow-level: ${fieldsArray.size()} top-level field entries`);

  // Extract all fields
  const extractedFields: BenchmarkField[] = [];

  for (let i = 0; i < fieldsArray.size(); i++) {
    const fieldRef = fieldsArray.get(i);
    const field = pdfDoc.context.lookup(fieldRef);
    if (!(field instanceof PDFDict)) continue;

    const name = getFieldName(field);
    const fieldType = getFieldType(field);
    const widgets = extractWidgets(field, pageMap);

    for (const widget of widgets) {
      const page = pages[widget.pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();

      const coords = pdfToNormalized(
        widget.rect.x,
        widget.rect.y,
        widget.rect.width,
        widget.rect.height,
        pageWidth,
        pageHeight
      );

      extractedFields.push({
        label: name || `Field ${i + 1}`,
        fieldType,
        coordinates: coords,
      });

      console.log(`  Field: "${name}" type=${fieldType} page=${widget.pageIndex + 1}`);
      console.log(`    PDF rect: (${widget.rect.x.toFixed(1)}, ${widget.rect.y.toFixed(1)}, ${widget.rect.width.toFixed(1)}x${widget.rect.height.toFixed(1)})`);
      console.log(`    Normalized: left=${coords.left.toFixed(1)}%, top=${coords.top.toFixed(1)}%, ${coords.width.toFixed(1)}%x${coords.height.toFixed(1)}%`);
    }
  }

  if (extractedFields.length > 0) {
    saveResults("acroform", "prep_questionnaire.json", extractedFields);

    const benchmark = loadBenchmark();
    const score = scoreFields(extractedFields, benchmark.fields);
    printScore("AcroForm Extraction", score);
  }
}

async function testOtherPdfs(pageMap: Map<PDFDict, number>) {
  // Test against other available PDFs to find one with AcroFields
  const testDir = resolve(PATHS.projectRoot, "docs/tests");
  const otherPdfs = [
    "Golf_Application_Form_JNRSHARKS_2025.pdf",
    "Changes to Care Arrangements.pdf",
  ];

  console.log("\n── Testing other PDFs for AcroForm ──");

  for (const filename of otherPdfs) {
    const pdfPath = resolve(testDir, filename);
    try {
      const buffer = readFileSync(pdfPath);
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      try {
        const form = doc.getForm();
        const fields = form.getFields();
        console.log(`  ${filename}: ${fields.length} AcroForm fields`);
        if (fields.length > 0) {
          for (const f of fields.slice(0, 5)) {
            console.log(`    - "${f.getName()}" (${f.constructor.name})`);
          }
          if (fields.length > 5) console.log(`    ... and ${fields.length - 5} more`);
        }
      } catch {
        console.log(`  ${filename}: No AcroForm`);
      }
    } catch (err) {
      console.log(`  ${filename}: Could not load (${err instanceof Error ? err.message : err})`);
    }
  }
}

main().catch(console.error);
