/**
 * Shared test utilities for coordinate accuracy benchmark scripts.
 *
 * Provides: benchmark loading, IoU scoring, result saving, and PDF rendering.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";

// ─── Paths ──────────────────────────────────────────────────────────────────

const BENCHMARK_ROOT = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(BENCHMARK_ROOT, "../..");

export const PATHS = {
  benchmarkRoot: BENCHMARK_ROOT,
  projectRoot: PROJECT_ROOT,
  groundTruth: resolve(BENCHMARK_ROOT, "benchmark/prep_questionnaire_page1.json"),
  geminiBaseline: resolve(BENCHMARK_ROOT, "results/raw/flash_low_single_page_full_rails.json"),
  testPdf: resolve(PROJECT_ROOT, "docs/tests/Prep Questionnaire 2025.pdf"),
  rawPageImage: resolve(BENCHMARK_ROOT, "results/debug/page1_raw-1.png"),
  resultsDir: resolve(BENCHMARK_ROOT, "results"),
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Coordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DateSegment extends Coordinates {
  part: "day" | "month" | "year" | "year2";
}

export interface TableConfig {
  columnHeaders: string[];
  coordinates: Coordinates;
  dataRows: number;
  columnPositions?: number[];
  rowHeights?: number[];
}

export interface BenchmarkField {
  label: string;
  fieldType: string;
  coordinates: Coordinates;
  groupLabel?: string | null;
  dateSegments?: DateSegment[];
  tableConfig?: TableConfig;
  rows?: number;
}

export interface BenchmarkData {
  document: string;
  source_pdf: string;
  page: number;
  version: string;
  notes: string;
  field_count: number;
  expanded_field_count: number;
  fields: BenchmarkField[];
}

export interface GeminiResult {
  config: Record<string, string>;
  fields: BenchmarkField[];
  score: {
    detection_rate: number;
    precision_rate: number;
    avg_iou: number;
    type_accuracy: number;
    label_accuracy: number;
    overall_score: number;
  };
  duration_ms: number;
  error: string | null;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

export function loadBenchmark(): BenchmarkData {
  return JSON.parse(readFileSync(PATHS.groundTruth, "utf-8"));
}

export function loadGeminiBaseline(): GeminiResult {
  return JSON.parse(readFileSync(PATHS.geminiBaseline, "utf-8"));
}

export function loadRawPageImage(): Buffer {
  return readFileSync(PATHS.rawPageImage);
}

export function loadTestPdf(): Buffer {
  return readFileSync(PATHS.testPdf);
}

// ─── IoU Scoring ────────────────────────────────────────────────────────────

/**
 * Calculate Intersection over Union for two bounding boxes.
 * Both in percentage coordinates (0-100).
 */
export function calculateIoU(pred: Coordinates, truth: Coordinates): number {
  const pLeft = pred.left;
  const pTop = pred.top;
  const pRight = pLeft + pred.width;
  const pBottom = pTop + pred.height;

  const tLeft = truth.left;
  const tTop = truth.top;
  const tRight = tLeft + truth.width;
  const tBottom = tTop + truth.height;

  const interLeft = Math.max(pLeft, tLeft);
  const interTop = Math.max(pTop, tTop);
  const interRight = Math.min(pRight, tRight);
  const interBottom = Math.min(pBottom, tBottom);

  if (interRight <= interLeft || interBottom <= interTop) return 0;

  const interArea = (interRight - interLeft) * (interBottom - interTop);
  const pArea = (pRight - pLeft) * (pBottom - pTop);
  const tArea = (tRight - tLeft) * (tBottom - tTop);
  const unionArea = pArea + tArea - interArea;

  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

/**
 * Calculate Levenshtein-based string similarity (0-1).
 */
export function labelSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (!na || !nb) return 0;

  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;

  // Simple Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= na.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= nb.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
  }

  const distance = matrix[na.length][nb.length];
  return 1 - distance / maxLen;
}

/**
 * Get the effective coordinates for a ground truth field.
 * Tables use tableConfig.coordinates, linkedDate uses bounding box of segments.
 */
export function getEffectiveCoords(field: BenchmarkField): Coordinates {
  if (field.tableConfig?.coordinates) {
    return field.tableConfig.coordinates;
  }
  if (field.dateSegments && field.dateSegments.length > 0) {
    return boundingBox(field.dateSegments);
  }
  return field.coordinates;
}

function boundingBox(segments: Coordinates[]): Coordinates {
  if (segments.length === 0) return { left: 0, top: 0, width: 0, height: 0 };

  let minLeft = Infinity, minTop = Infinity;
  let maxRight = -Infinity, maxBottom = -Infinity;

  for (const s of segments) {
    minLeft = Math.min(minLeft, s.left);
    minTop = Math.min(minTop, s.top);
    maxRight = Math.max(maxRight, s.left + s.width);
    maxBottom = Math.max(maxBottom, s.top + s.height);
  }

  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}

// ─── Field Matching ─────────────────────────────────────────────────────────

export interface FieldMatch {
  predicted: BenchmarkField;
  groundTruth: BenchmarkField;
  iou: number;
  labelSim: number;
  typeCorrect: boolean;
}

export interface ScoreResult {
  detectionRate: number;
  precisionRate: number;
  avgIoU: number;
  typeAccuracy: number;
  labelAccuracy: number;
  overallScore: number;
  matches: FieldMatch[];
  missed: BenchmarkField[];
  extra: BenchmarkField[];
  iouDistribution: { "<25%": number; "25-50%": number; "50-75%": number; ">75%": number };
}

/**
 * Match predicted fields to ground truth using greedy best-match.
 * (Simpler than Hungarian algorithm but good enough for benchmark comparison.)
 */
export function scoreFields(
  predicted: BenchmarkField[],
  groundTruth: BenchmarkField[]
): ScoreResult {
  const iouThreshold = 0.1;

  // Build score matrix
  const scores: { pi: number; gi: number; score: number; iou: number; labelSim: number }[] = [];

  for (let pi = 0; pi < predicted.length; pi++) {
    const predCoords = getEffectiveCoords(predicted[pi]);
    for (let gi = 0; gi < groundTruth.length; gi++) {
      const truthCoords = getEffectiveCoords(groundTruth[gi]);
      const iou = calculateIoU(predCoords, truthCoords);
      const lsim = labelSimilarity(predicted[pi].label, groundTruth[gi].label);
      const score = 0.6 * iou + 0.4 * lsim;
      if (iou >= iouThreshold) {
        scores.push({ pi, gi, score, iou, labelSim: lsim });
      }
    }
  }

  // Greedy matching (sort by score descending, assign best matches first)
  scores.sort((a, b) => b.score - a.score);
  const matchedPred = new Set<number>();
  const matchedTruth = new Set<number>();
  const matches: FieldMatch[] = [];

  for (const s of scores) {
    if (matchedPred.has(s.pi) || matchedTruth.has(s.gi)) continue;
    const pred = predicted[s.pi];
    const truth = groundTruth[s.gi];
    const predType = pred.fieldType.toLowerCase();
    const truthType = truth.fieldType.toLowerCase();
    const compatPairs = new Set(["text-textarea", "textarea-text", "date-linkeddate", "linkeddate-date"]);
    const typeCorrect = predType === truthType || compatPairs.has(`${predType}-${truthType}`);

    matches.push({
      predicted: pred,
      groundTruth: truth,
      iou: s.iou,
      labelSim: s.labelSim,
      typeCorrect,
    });
    matchedPred.add(s.pi);
    matchedTruth.add(s.gi);
  }

  const missed = groundTruth.filter((_, i) => !matchedTruth.has(i));
  const extra = predicted.filter((_, i) => !matchedPred.has(i));

  const nMatched = matches.length;
  const nTruth = groundTruth.length;
  const nPred = predicted.length;

  const detectionRate = nTruth > 0 ? (nMatched / nTruth) * 100 : 0;
  const precisionRate = nPred > 0 ? (nMatched / nPred) * 100 : 0;

  const ious = matches.map((m) => m.iou);
  const avgIoU = ious.length > 0 ? (ious.reduce((a, b) => a + b, 0) / ious.length) * 100 : 0;

  const typeCorrectCount = matches.filter((m) => m.typeCorrect).length;
  const typeAccuracy = nMatched > 0 ? (typeCorrectCount / nMatched) * 100 : 0;

  const labelSims = matches.map((m) => m.labelSim);
  const labelAccuracy = labelSims.length > 0 ? (labelSims.reduce((a, b) => a + b, 0) / labelSims.length) * 100 : 0;

  const overallScore =
    0.25 * detectionRate +
    0.10 * precisionRate +
    0.30 * avgIoU +
    0.20 * typeAccuracy +
    0.15 * labelAccuracy;

  const iouDistribution = {
    "<25%": ious.filter((v) => v < 0.25).length,
    "25-50%": ious.filter((v) => v >= 0.25 && v < 0.5).length,
    "50-75%": ious.filter((v) => v >= 0.5 && v < 0.75).length,
    ">75%": ious.filter((v) => v >= 0.75).length,
  };

  return {
    detectionRate,
    precisionRate,
    avgIoU,
    typeAccuracy,
    labelAccuracy,
    overallScore,
    matches,
    missed,
    extra,
    iouDistribution,
  };
}

// ─── Result Saving ──────────────────────────────────────────────────────────

export function saveResults(subdir: string, filename: string, fields: BenchmarkField[]): string {
  const dir = resolve(PATHS.resultsDir, subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = resolve(dir, filename);
  writeFileSync(path, JSON.stringify({ fields }, null, 2));
  console.log(`[AutoForm] Results saved to: ${path}`);
  return path;
}

// ─── Display ────────────────────────────────────────────────────────────────

export function printScore(label: string, score: ScoreResult): void {
  console.log(`\n── ${label} ──`);
  console.log(`  Detection:  ${score.detectionRate.toFixed(1)}% (${score.matches.length}/${score.matches.length + score.missed.length})`);
  console.log(`  Precision:  ${score.precisionRate.toFixed(1)}%`);
  console.log(`  Avg IoU:    ${score.avgIoU.toFixed(1)}%`);
  console.log(`  Types:      ${score.typeAccuracy.toFixed(1)}%`);
  console.log(`  Labels:     ${score.labelAccuracy.toFixed(1)}%`);
  console.log(`  Overall:    ${score.overallScore.toFixed(1)}%`);
  console.log(`  IoU dist:   <25%: ${score.iouDistribution["<25%"]}, 25-50%: ${score.iouDistribution["25-50%"]}, 50-75%: ${score.iouDistribution["50-75%"]}, >75%: ${score.iouDistribution[">75%"]}`);
}

export function printFieldComparison(
  label: string,
  beforeMatches: FieldMatch[],
  afterMatches: FieldMatch[]
): void {
  console.log(`\n── Per-field IoU comparison: ${label} ──`);
  console.log(`  ${"Field".padEnd(45)} ${"Before".padStart(8)} ${"After".padStart(8)} ${"Delta".padStart(8)}`);
  console.log(`  ${"─".repeat(45)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)}`);

  for (const after of afterMatches) {
    const before = beforeMatches.find(
      (m) => labelSimilarity(m.groundTruth.label, after.groundTruth.label) > 0.8
    );
    const beforeIoU = before ? (before.iou * 100).toFixed(1) : "  miss";
    const afterIoU = (after.iou * 100).toFixed(1);
    const delta = before
      ? ((after.iou - before.iou) * 100).toFixed(1)
      : "   new";
    const indicator = before && after.iou > before.iou ? " +" : before && after.iou < before.iou ? " -" : "  ";

    console.log(
      `  ${after.groundTruth.label.padEnd(45)} ${beforeIoU.padStart(8)} ${afterIoU.padStart(8)} ${(indicator + delta).padStart(8)}`
    );
  }
}

export function printScoreComparison(before: ScoreResult, after: ScoreResult): void {
  console.log(`\n── Score Comparison ──`);
  console.log(`  ${"Metric".padEnd(15)} ${"Before".padStart(8)} ${"After".padStart(8)} ${"Delta".padStart(8)}`);
  console.log(`  ${"─".repeat(15)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)}`);

  const metrics: [string, number, number][] = [
    ["Detection", before.detectionRate, after.detectionRate],
    ["Precision", before.precisionRate, after.precisionRate],
    ["Avg IoU", before.avgIoU, after.avgIoU],
    ["Types", before.typeAccuracy, after.typeAccuracy],
    ["Labels", before.labelAccuracy, after.labelAccuracy],
    ["Overall", before.overallScore, after.overallScore],
  ];

  for (const [name, bVal, aVal] of metrics) {
    const delta = aVal - bVal;
    const sign = delta >= 0 ? "+" : "";
    console.log(
      `  ${name.padEnd(15)} ${bVal.toFixed(1).padStart(8)} ${aVal.toFixed(1).padStart(8)} ${(sign + delta.toFixed(1)).padStart(8)}`
    );
  }
}
