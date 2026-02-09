#!/usr/bin/env npx tsx
/**
 * Full Production Pipeline Benchmark
 *
 * Tests the complete coordinate snapping pipeline using production code from
 * src/lib/coordinate-snapping/, including all new features:
 *
 * 1. Header cell filter (remove prefilled text fields)
 * 2. OCR label snap (push left edge past label)
 * 3. CV line snap (pixel-level horizontal lines)
 * 4. Vector line snap (PDF vector horizontal lines)
 * 5. Checkbox rect snap (small squares)
 * 6. Textarea rect snap (large matching rectangles)
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_full_pipeline.ts
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";

// ─── Import production code ─────────────────────────────────────────────────
import {
  snapFieldCoordinates,
  prepareGeometry,
  snapWithPrecomputedGeometry,
  ocrPageDataToWords,
  filterPrefilledFields,
} from "../../../src/lib/coordinate-snapping";
import type { OcrWordWithCoords, OcrPageData } from "../../../src/lib/coordinate-snapping";
import { extractVectorGeometry } from "../../../src/lib/coordinate-snapping/vector-snap";

// ─── Import benchmark utilities ─────────────────────────────────────────────
import {
  loadBenchmark,
  loadGeminiBaseline,
  loadRawPageImage,
  loadTestPdf,
  saveResults,
  scoreFields,
  printScore,
  printScoreComparison,
  printFieldComparison,
  PATHS,
  type BenchmarkField,
  type Coordinates,
  type ScoreResult,
} from "./test_utils";

// ─── OCR Data Loading ───────────────────────────────────────────────────────

interface OcrWord {
  content: string;
  polygon: number[];
  confidence: number;
}

interface OcrPage {
  pageNumber: number;
  width: number;
  height: number;
  unit: "pixel" | "inch";
  lines: Array<{ content: string; polygon: number[]; words: OcrWord[] }>;
  words: OcrWord[];
}

/**
 * Load cached OCR data and convert to OcrWordWithCoords (percentage coordinates).
 * Handles both pixel and inch units.
 */
function loadOcrWords(): OcrWordWithCoords[] {
  const OCR_CACHE = resolve(PATHS.resultsDir, "ocr/prep_questionnaire_ocr.json");
  if (!existsSync(OCR_CACHE)) {
    console.log("WARNING: No cached OCR data found.");
    return [];
  }

  const ocrResult: { pages: OcrPage[] } = JSON.parse(readFileSync(OCR_CACHE, "utf-8"));
  const page = ocrResult.pages[0];
  if (!page) return [];

  // Collect raw words (page-level, since line-level words are empty)
  let rawWords: OcrWord[] = [];
  for (const line of page.lines) {
    if (line.words && line.words.length > 0) {
      rawWords.push(...line.words);
    }
  }
  if (rawWords.length === 0 && page.words) {
    rawWords = page.words;
  }

  // Convert polygons to percentage coordinates
  const words: OcrWordWithCoords[] = [];
  for (const word of rawWords) {
    if (word.polygon.length < 8) continue;
    const xs = [word.polygon[0], word.polygon[2], word.polygon[4], word.polygon[6]];
    const ys = [word.polygon[1], word.polygon[3], word.polygon[5], word.polygon[7]];
    words.push({
      content: word.content,
      coords: {
        left: (Math.min(...xs) / page.width) * 100,
        top: (Math.min(...ys) / page.height) * 100,
        width: ((Math.max(...xs) - Math.min(...xs)) / page.width) * 100,
        height: ((Math.max(...ys) - Math.min(...ys)) / page.height) * 100,
      },
      confidence: word.confidence,
    });
  }

  return words;
}

/**
 * Convert cached OCR data to OcrPageData format (for ocrPageDataToWords).
 * This tests the production OcrPageData → OcrWordWithCoords conversion path.
 */
function loadOcrAsPageData(): OcrPageData | null {
  const OCR_CACHE = resolve(PATHS.resultsDir, "ocr/prep_questionnaire_ocr.json");
  if (!existsSync(OCR_CACHE)) return null;

  const ocrResult: { pages: OcrPage[] } = JSON.parse(readFileSync(OCR_CACHE, "utf-8"));
  const page = ocrResult.pages[0];
  if (!page) return null;

  let rawWords: OcrWord[] = [];
  for (const line of page.lines) {
    if (line.words && line.words.length > 0) rawWords.push(...line.words);
  }
  if (rawWords.length === 0 && page.words) rawWords = page.words;

  return {
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    unit: page.unit,
    words: rawWords.map((w) => ({
      content: w.content,
      polygon: w.polygon,
      confidence: w.confidence,
    })),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║         FULL PRODUCTION PIPELINE BENCHMARK                          ║");
  console.log("║         OCR → CV → Vector Lines → Checkbox Rect → Textarea Rect    ║");
  console.log("║         + Header Cell Filter                                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  const pdfBuffer = loadTestPdf();
  const imageBuffer = loadRawPageImage();
  const rawBaseline = loadGeminiBaseline();
  const benchmark = loadBenchmark();

  // Ensure all fields have coordinates (tables use tableConfig.coordinates)
  const baseline = {
    ...rawBaseline,
    fields: rawBaseline.fields.map((f) => ({
      ...f,
      coordinates: f.coordinates ?? f.tableConfig?.coordinates ?? { left: 0, top: 0, width: 0, height: 0 },
    })),
  };

  // Load OCR data (both formats)
  const ocrWords = loadOcrWords();
  const ocrPageData = loadOcrAsPageData();
  const ocrWordsFromPageData = ocrPageData ? ocrPageDataToWords(ocrPageData) : [];

  console.log("Data loaded:");
  console.log(`  Benchmark fields: ${benchmark.fields.length} (${benchmark.expanded_field_count} expanded)`);
  console.log(`  Gemini baseline:  ${baseline.fields.length} fields`);
  console.log(`  OCR words:        ${ocrWords.length} (direct), ${ocrWordsFromPageData.length} (via ocrPageDataToWords)`);

  // ── Score baseline ──────────────────────────────────────────────────────
  const baselineScore = scoreFields(baseline.fields, benchmark.fields);

  console.log("\n" + "═".repeat(70));
  console.log("  BASELINE (Gemini only, no post-processing)");
  console.log("═".repeat(70));
  printScore("Gemini Baseline", baselineScore);

  // ── Test individual stages ──────────────────────────────────────────────

  type Stage = { name: string; fields: BenchmarkField[]; score: ScoreResult };
  const stages: Stage[] = [];

  // A. Header filter only
  if (ocrWords.length > 0) {
    const { fields: filtered, filteredCount } = filterPrefilledFields(baseline.fields, ocrWords);
    const score = scoreFields(filtered, benchmark.fields);
    stages.push({ name: "Header filter only", fields: filtered, score });
    console.log(`\n  Header filter: removed ${filteredCount} prefilled fields`);
  }

  // B. Prepare geometry (same as production: parallel with Gemini)
  console.log("\n  Preparing geometry (CV + Vector)...");
  const geoStart = Date.now();
  const geometry = await prepareGeometry(imageBuffer, pdfBuffer, 1);
  const geoMs = Date.now() - geoStart;
  console.log(`  Geometry ready in ${geoMs}ms:`);
  console.log(`    CV lines:     ${geometry.cvLines.length}`);
  console.log(`    Vector lines: ${geometry.vectorLines.length}`);
  console.log(`    Vector rects: ${geometry.vectorRects.length}`);
  console.log(`    Page AR:      ${geometry.pageAspectRatio.toFixed(3)}`);

  // C. Old pipeline (OCR → CV → Vector lines only, no header filter, no rect snap)
  {
    const snapResult = snapWithPrecomputedGeometry(
      baseline.fields,
      geometry.cvLines,
      geometry.vectorLines,
      [], // no rects
      geometry.pageAspectRatio,
      ocrWords.length > 0 ? ocrWords : undefined,
    );
    const score = scoreFields(snapResult.fields, benchmark.fields);
    stages.push({ name: "Old pipeline (lines only)", fields: snapResult.fields, score });
  }

  // D. Full pipeline WITHOUT header filter
  {
    const snapResult = snapWithPrecomputedGeometry(
      baseline.fields,
      geometry.cvLines,
      geometry.vectorLines,
      geometry.vectorRects,
      geometry.pageAspectRatio,
      ocrWords.length > 0 ? ocrWords : undefined,
    );
    const score = scoreFields(snapResult.fields, benchmark.fields);
    stages.push({ name: "Full snap (no filter)", fields: snapResult.fields, score });
  }

  // E. Header filter → Full pipeline (THE PRODUCTION PATH)
  let productionFields: BenchmarkField[] = baseline.fields;
  let productionScore: ScoreResult;
  {
    // Step 1: Filter headers
    let filtered = baseline.fields;
    let headerFilteredCount = 0;
    if (ocrWords.length > 0) {
      const filterResult = filterPrefilledFields(baseline.fields, ocrWords);
      filtered = filterResult.fields;
      headerFilteredCount = filterResult.filteredCount;
    }

    // Step 2: Snap
    const snapResult = snapWithPrecomputedGeometry(
      filtered,
      geometry.cvLines,
      geometry.vectorLines,
      geometry.vectorRects,
      geometry.pageAspectRatio,
      ocrWords.length > 0 ? ocrWords : undefined,
    );

    productionFields = snapResult.fields;
    productionScore = scoreFields(snapResult.fields, benchmark.fields);
    stages.push({ name: "PRODUCTION (filter+snap)", fields: snapResult.fields, score: productionScore });

    console.log(`\n  Production pipeline stats:`);
    console.log(`    Headers filtered: ${headerFilteredCount}`);
    console.log(`    OCR snapped:      ${snapResult.result.ocrSnapped}`);
    console.log(`    CV snapped:       ${snapResult.result.cvSnapped}`);
    console.log(`    Vector snapped:   ${snapResult.result.vectorSnapped}`);
    console.log(`    Checkbox snapped: ${snapResult.result.checkboxRectSnapped}`);
    console.log(`    Textarea snapped: ${snapResult.result.textareaRectSnapped}`);
    console.log(`    Duration:         ${snapResult.result.durationMs}ms`);
  }

  // F. Also test snapFieldCoordinates (the all-in-one async function)
  {
    const snapResult = await snapFieldCoordinates(
      baseline.fields,
      imageBuffer,
      pdfBuffer,
      1,
      ocrWords.length > 0 ? ocrWords : undefined,
    );
    const score = scoreFields(snapResult.fields, benchmark.fields);
    stages.push({ name: "snapFieldCoordinates()", fields: snapResult.fields, score });
  }

  // ── Summary Table ─────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(78));
  console.log("  RESULTS SUMMARY");
  console.log("═".repeat(78));

  console.log(`  ${"Pipeline".padEnd(32)} ${"Detect".padStart(7)} ${"Precis".padStart(7)} ${"AvgIoU".padStart(7)} ${"Delta".padStart(7)} ${"Types".padStart(6)} ${"Overll".padStart(7)}`);
  console.log(`  ${"─".repeat(32)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(6)} ${"─".repeat(7)}`);

  console.log(`  ${"Gemini Baseline".padEnd(32)} ${baselineScore.detectionRate.toFixed(1).padStart(6)}% ${baselineScore.precisionRate.toFixed(1).padStart(6)}% ${baselineScore.avgIoU.toFixed(1).padStart(6)}% ${"--".padStart(7)} ${baselineScore.typeAccuracy.toFixed(1).padStart(5)}% ${baselineScore.overallScore.toFixed(1).padStart(6)}%`);

  // Sort by IoU
  stages.sort((a, b) => b.score.avgIoU - a.score.avgIoU);

  for (const stage of stages) {
    const delta = stage.score.avgIoU - baselineScore.avgIoU;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
    const name = stage.name === "PRODUCTION (filter+snap)" ? `★ ${stage.name}` : `  ${stage.name}`;
    console.log(`${name.padEnd(34)} ${stage.score.detectionRate.toFixed(1).padStart(6)}% ${stage.score.precisionRate.toFixed(1).padStart(6)}% ${stage.score.avgIoU.toFixed(1).padStart(6)}% ${deltaStr.padStart(7)} ${stage.score.typeAccuracy.toFixed(1).padStart(5)}% ${stage.score.overallScore.toFixed(1).padStart(6)}%`);
  }

  // ── Detailed comparison ───────────────────────────────────────────────

  console.log("\n" + "═".repeat(78));
  console.log("  PRODUCTION PIPELINE vs BASELINE — DETAILED");
  console.log("═".repeat(78));

  printScoreComparison(baselineScore, productionScore!);
  printFieldComparison("Production Pipeline", baselineScore.matches, productionScore!.matches);

  // ── IoU distribution ──────────────────────────────────────────────────

  console.log("\n── IoU Distribution ──");
  console.log(`  Baseline:    <25%: ${baselineScore.iouDistribution["<25%"]}, 25-50%: ${baselineScore.iouDistribution["25-50%"]}, 50-75%: ${baselineScore.iouDistribution["50-75%"]}, >75%: ${baselineScore.iouDistribution[">75%"]}`);
  console.log(`  Production:  <25%: ${productionScore!.iouDistribution["<25%"]}, 25-50%: ${productionScore!.iouDistribution["25-50%"]}, 50-75%: ${productionScore!.iouDistribution["50-75%"]}, >75%: ${productionScore!.iouDistribution[">75%"]}`);

  // ── Missed and extra fields ───────────────────────────────────────────

  if (productionScore!.missed.length > 0) {
    console.log(`\n── Missed fields (${productionScore!.missed.length}) ──`);
    for (const f of productionScore!.missed) {
      console.log(`  - ${f.label} (${f.fieldType})`);
    }
  }

  if (productionScore!.extra.length > 0) {
    console.log(`\n── Extra fields (${productionScore!.extra.length}) ──`);
    for (const f of productionScore!.extra) {
      console.log(`  - ${f.label} (${f.fieldType})`);
    }
  }

  // ── Save results ──────────────────────────────────────────────────────

  saveResults("full-pipeline", "prep_questionnaire_production.json", productionFields);

  // ── Final summary ─────────────────────────────────────────────────────

  const improvement = productionScore!.avgIoU - baselineScore.avgIoU;
  console.log("\n" + "═".repeat(78));
  console.log(`  FINAL: ${baselineScore.avgIoU.toFixed(1)}% → ${productionScore!.avgIoU.toFixed(1)}% avg IoU (+${improvement.toFixed(1)}%)`);
  console.log(`         ${baselineScore.overallScore.toFixed(1)}% → ${productionScore!.overallScore.toFixed(1)}% overall score`);
  console.log("═".repeat(78));
}

main().catch(console.error);
