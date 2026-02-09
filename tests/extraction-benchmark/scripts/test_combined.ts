#!/usr/bin/env npx tsx
/**
 * Script 5: Combined Pipeline Test
 *
 * Chains the best approaches together to measure cumulative improvement.
 * Tests all orderings of OCR snap, CV line snap, and PDF vector snap.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_combined.ts
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
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

// ─── Import snapping functions from individual scripts ──────────────────────

// We'll inline minimal versions of each snapping approach rather than importing,
// since the individual scripts export functions differently.

// ── 1. OCR Snap (left-boundary only) ───────────────────────────────────────

interface OcrWord {
  content: string;
  polygon: number[];
  confidence: number;
}

interface OcrLine {
  content: string;
  polygon: number[];
  words: OcrWord[];
}

interface OcrPage {
  pageNumber: number;
  width: number;
  height: number;
  unit: "pixel" | "inch";
  lines: OcrLine[];
  words: OcrWord[];
}

interface OcrResult {
  pages: OcrPage[];
}

interface WordWithCoords {
  content: string;
  coords: Coordinates;
  confidence: number;
}

interface LabelMatch {
  label: string;
  matchedWords: WordWithCoords[];
  labelCoords: Coordinates;
  confidence: number;
}

function polygonToCoords(polygon: number[], pageWidth: number, pageHeight: number): Coordinates {
  if (polygon.length < 8) return { left: 0, top: 0, width: 0, height: 0 };
  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];
  return {
    left: (Math.min(...xs) / pageWidth) * 100,
    top: (Math.min(...ys) / pageHeight) * 100,
    width: ((Math.max(...xs) - Math.min(...xs)) / pageWidth) * 100,
    height: ((Math.max(...ys) - Math.min(...ys)) / pageHeight) * 100,
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'").replace(/[^\w\s'/-]/g, "").trim();
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}

function boundingBoxOfWords(words: WordWithCoords[]): Coordinates {
  if (words.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (const w of words) {
    minL = Math.min(minL, w.coords.left);
    minT = Math.min(minT, w.coords.top);
    maxR = Math.max(maxR, w.coords.left + w.coords.width);
    maxB = Math.max(maxB, w.coords.top + w.coords.height);
  }
  return { left: minL, top: minT, width: maxR - minL, height: maxB - minT };
}

function coordDistance(a: Coordinates, b: Coordinates): number {
  return Math.sqrt((a.left + a.width / 2 - (b.left + b.width / 2)) ** 2 + (a.top + a.height / 2 - (b.top + b.height / 2)) ** 2);
}

function matchLabelToOcrWords(label: string, words: WordWithCoords[], geminiCoords: Coordinates): LabelMatch | null {
  const normLabel = normalizeText(label);
  const labelTokens = normLabel.split(/\s+/).filter(Boolean);
  if (labelTokens.length === 0) return null;

  type Candidate = { startIdx: number; endIdx: number; score: number };
  const candidates: Candidate[] = [];

  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    let matchedTokens = 0;
    let endIdx = startIdx;
    let tokenIdx = 0;
    while (endIdx < words.length && tokenIdx < labelTokens.length) {
      const wordNorm = normalizeText(words[endIdx].content);
      if (wordNorm === labelTokens[tokenIdx]) { matchedTokens++; tokenIdx++; endIdx++; }
      else if (labelTokens[tokenIdx].includes(wordNorm) || wordNorm.includes(labelTokens[tokenIdx])) { matchedTokens += 0.8; tokenIdx++; endIdx++; }
      else break;
    }
    if (matchedTokens >= labelTokens.length * 0.6) {
      const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
      const proximity = 1 / (1 + coordDistance(matchedBox, geminiCoords));
      candidates.push({ startIdx, endIdx, score: 0.6 * (matchedTokens / labelTokens.length) + 0.4 * proximity });
    }
  }

  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    for (let windowSize = 1; windowSize <= Math.min(labelTokens.length + 2, words.length - startIdx); windowSize++) {
      const endIdx = startIdx + windowSize;
      const joinedWords = words.slice(startIdx, endIdx).map((w) => normalizeText(w.content)).join(" ");
      const similarity = stringSimilarity(normLabel, joinedWords);
      if (similarity > 0.7) {
        const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
        const proximity = 1 / (1 + coordDistance(matchedBox, geminiCoords));
        if (!candidates.some((c) => c.startIdx === startIdx && c.endIdx === endIdx)) {
          candidates.push({ startIdx, endIdx, score: 0.5 * similarity + 0.5 * proximity });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const matchedWords = words.slice(best.startIdx, best.endIdx);
  return { label, matchedWords, labelCoords: boundingBoxOfWords(matchedWords), confidence: best.score };
}

function applyOcrSnap(fields: BenchmarkField[], ocrWords: WordWithCoords[]): BenchmarkField[] {
  const labelMatches: Map<number, LabelMatch> = new Map();
  const allLabelMatches: LabelMatch[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const effectiveCoords = field.tableConfig?.coordinates ?? field.coordinates ?? { left: 50, top: 50, width: 10, height: 2 };
    const match = matchLabelToOcrWords(field.label, ocrWords, effectiveCoords);
    if (match) { labelMatches.set(i, match); allLabelMatches.push(match); }
  }

  return fields.map((field, i) => {
    const match = labelMatches.get(i);
    if (!match) return field;
    if (["checkbox", "table", "linkedDate", "textarea"].includes(field.fieldType)) return field;

    const labelBox = match.labelCoords;
    const geminiCoords = field.coordinates;
    const labelRight = labelBox.left + labelBox.width;
    const geminiRight = geminiCoords.left + geminiCoords.width;
    const isSameLine = Math.abs(labelBox.top - geminiCoords.top) < 3;
    const labelShorterThanField = labelRight < geminiRight - 2;
    const isOverlapping = geminiCoords.left < labelRight;
    const shiftAmount = labelRight - geminiCoords.left;

    if (isSameLine && isOverlapping && labelShorterThanField && shiftAmount > 0 && shiftAmount < 10) {
      const newLeft = labelRight;
      const newWidth = geminiRight - newLeft;
      if (newWidth < geminiCoords.width * 0.6) return field;

      const snapped = { left: Number(newLeft.toFixed(2)), top: geminiCoords.top, width: Number(newWidth.toFixed(2)), height: geminiCoords.height };
      if (snapped.left < 0 || snapped.left + snapped.width > 100 || snapped.width < 2) return field;
      return { ...field, coordinates: snapped };
    }
    return field;
  });
}

// ── 2. CV Line Snap ─────────────────────────────────────────────────────────

interface Line { y: number; xStart: number; xEnd: number; length: number; }
interface LinePct { y: number; left: number; right: number; width: number; }

async function detectHorizontalLines(imageBuffer: Buffer, options = { threshold: 200, minLengthPct: 2, mergeDistance: 5 }): Promise<Line[]> {
  const { data, info } = await sharp(imageBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const minLineLength = width * (options.minLengthPct / 100);
  const lines: Line[] = [];

  for (let y = 0; y < height; y++) {
    let currentStart = -1;
    let consecutiveDark = 0;
    for (let x = 0; x < width; x++) {
      const pixelValue = data[y * width * channels + x * channels];
      if (pixelValue < options.threshold) {
        if (currentStart === -1) currentStart = x;
        consecutiveDark++;
      } else {
        if (currentStart !== -1 && consecutiveDark > minLineLength) {
          lines.push({ y, xStart: currentStart, xEnd: x, length: consecutiveDark });
        }
        currentStart = -1;
        consecutiveDark = 0;
      }
    }
    if (currentStart !== -1 && consecutiveDark > minLineLength) {
      lines.push({ y, xStart: currentStart, xEnd: width, length: consecutiveDark });
    }
  }
  return mergeNearbyLines(lines, options.mergeDistance);
}

function mergeNearbyLines(lines: Line[], mergeDistance: number): Line[] {
  if (lines.length === 0) return [];
  lines.sort((a, b) => a.y - b.y);
  const merged: Line[] = [];
  let current = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    if (next.y - current.y < mergeDistance && Math.max(current.xStart, next.xStart) < Math.min(current.xEnd, next.xEnd)) {
      const minX = Math.min(current.xStart, next.xStart);
      const maxX = Math.max(current.xEnd, next.xEnd);
      current = { y: Math.round((current.y + next.y) / 2), xStart: minX, xEnd: maxX, length: maxX - minX };
    } else { merged.push(current); current = next; }
  }
  merged.push(current);
  return merged;
}

function applyCvSnap(fields: BenchmarkField[], hLinesPct: LinePct[], maxSnapDistPct = 3.0): BenchmarkField[] {
  return fields.map((field) => {
    if (!["text", "date", "linkedDate"].includes(field.fieldType)) return field;

    const fieldBottom = field.coordinates.top + field.coordinates.height;
    const fieldLeft = field.coordinates.left;
    const fieldRight = fieldLeft + field.coordinates.width;

    let bestLine: LinePct | null = null;
    let minDist = maxSnapDistPct;

    for (const line of hLinesPct) {
      const overlapLeft = Math.max(fieldLeft, line.left);
      const overlapRight = Math.min(fieldRight, line.right);
      if (overlapRight <= overlapLeft) continue;
      if (overlapRight - overlapLeft < field.coordinates.width * 0.5) continue;
      const dist = Math.abs(line.y - fieldBottom);
      if (dist < minDist) { minDist = dist; bestLine = line; }
    }

    if (bestLine) {
      const newTop = bestLine.y - field.coordinates.height;
      let newLeft = field.coordinates.left;
      let newWidth = field.coordinates.width;
      if (Math.abs(bestLine.width - field.coordinates.width) < 8) { newLeft = bestLine.left; newWidth = bestLine.width; }
      return { ...field, coordinates: { left: Number(newLeft.toFixed(2)), top: Number(newTop.toFixed(2)), width: Number(newWidth.toFixed(2)), height: field.coordinates.height } };
    }
    return field;
  });
}

// ── 3. PDF Vector Snap ──────────────────────────────────────────────────────

interface VectorLine { x1: number; y1: number; x2: number; y2: number; isHorizontal: boolean; isVertical: boolean; }

async function extractVectorLines(pdfBuffer: Buffer, pageNumber: number): Promise<VectorLine[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.0 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  const lines: VectorLine[] = [];
  const ctmStack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let currentX = 0, currentY = 0;
  let pathStartX = 0, pathStartY = 0;
  const pathSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];

  function transformPoint(x: number, y: number): [number, number] {
    return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  }
  function toPercentX(x: number): number { return (x / pageWidth) * 100; }
  function toPercentY(y: number): number { return ((pageHeight - y) / pageHeight) * 100; }

  function commitSegments() {
    for (const seg of pathSegments) {
      const dx = Math.abs(seg.x2 - seg.x1);
      const dy = Math.abs(seg.y2 - seg.y1);
      const isH = dy < 1 && dx > 5;
      const isV = dx < 1 && dy > 5;
      if (isH || isV) {
        lines.push({
          x1: toPercentX(Math.min(seg.x1, seg.x2)),
          y1: toPercentY(Math.max(seg.y1, seg.y2)),
          x2: toPercentX(Math.max(seg.x1, seg.x2)),
          y2: toPercentY(Math.min(seg.y1, seg.y2)),
          isHorizontal: isH,
          isVertical: isV,
        });
      }
    }
    pathSegments.length = 0;
  }

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save: ctmStack.push([...ctm]); break;
      case OPS.restore: if (ctmStack.length > 0) ctm = ctmStack.pop()!; break;
      case OPS.transform: {
        const [a, b, c, d, e, f] = args;
        ctm = [ctm[0]*a+ctm[2]*b, ctm[1]*a+ctm[3]*b, ctm[0]*c+ctm[2]*d, ctm[1]*c+ctm[3]*d, ctm[0]*e+ctm[2]*f+ctm[4], ctm[1]*e+ctm[3]*f+ctm[5]];
        break;
      }
      case OPS.constructPath: {
        const ops = args[0];
        const pathArgs = args[1];

        if (!Array.isArray(ops)) {
          // Newer pdfjs format: args[1] is array of objects with numeric keys
          if (Array.isArray(pathArgs)) {
            for (const obj of pathArgs) {
              const flat: number[] = [];
              let k = 0;
              while (obj[k] !== undefined) { flat.push(obj[k]); k++; }

              let fi = 0;
              while (fi < flat.length) {
                const opCode = flat[fi]; fi++;
                if (opCode === 0) { // moveTo
                  const [tx, ty] = transformPoint(flat[fi], flat[fi + 1]);
                  currentX = tx; currentY = ty; pathStartX = tx; pathStartY = ty; fi += 2;
                } else if (opCode === 1) { // lineTo
                  const [tx, ty] = transformPoint(flat[fi], flat[fi + 1]);
                  pathSegments.push({ x1: currentX, y1: currentY, x2: tx, y2: ty });
                  currentX = tx; currentY = ty; fi += 2;
                } else if (opCode === 2) { fi += 6; } // curveTo
                else if (opCode === 3) { // rectangle
                  const rx = flat[fi], ry = flat[fi+1], rw = flat[fi+2], rh = flat[fi+3]; fi += 4;
                  const [x1, y1] = transformPoint(rx, ry);
                  const [x2, y2] = transformPoint(rx + rw, ry + rh);
                  const rl = Math.min(x1,x2), rb = Math.min(y1,y2), rW = Math.abs(x2-x1), rH = Math.abs(y2-y1);
                  pathSegments.push({ x1: rl, y1: rb, x2: rl + rW, y2: rb });
                  pathSegments.push({ x1: rl, y1: rb + rH, x2: rl + rW, y2: rb + rH });
                  pathSegments.push({ x1: rl, y1: rb, x2: rl, y2: rb + rH });
                  pathSegments.push({ x1: rl + rW, y1: rb, x2: rl + rW, y2: rb + rH });
                } else if (opCode === 4) { // closePath
                  pathSegments.push({ x1: currentX, y1: currentY, x2: pathStartX, y2: pathStartY });
                  currentX = pathStartX; currentY = pathStartY;
                } else { break; }
              }
            }
          }
          break;
        }

        // Standard pdfjs format
        let argIdx = 0;
        for (const op of ops) {
          if (op === OPS.moveTo) {
            const [tx, ty] = transformPoint(pathArgs[argIdx], pathArgs[argIdx + 1]);
            currentX = tx; currentY = ty; pathStartX = tx; pathStartY = ty; argIdx += 2;
          } else if (op === OPS.lineTo) {
            const [tx, ty] = transformPoint(pathArgs[argIdx], pathArgs[argIdx + 1]);
            pathSegments.push({ x1: currentX, y1: currentY, x2: tx, y2: ty });
            currentX = tx; currentY = ty; argIdx += 2;
          } else if (op === OPS.rectangle) {
            const rx = pathArgs[argIdx], ry = pathArgs[argIdx+1], rw = pathArgs[argIdx+2], rh = pathArgs[argIdx+3]; argIdx += 4;
            const [x1, y1] = transformPoint(rx, ry);
            const [x2, y2] = transformPoint(rx + rw, ry + rh);
            const rl = Math.min(x1,x2), rb = Math.min(y1,y2), rW = Math.abs(x2-x1), rH = Math.abs(y2-y1);
            pathSegments.push({ x1: rl, y1: rb, x2: rl + rW, y2: rb });
            pathSegments.push({ x1: rl, y1: rb + rH, x2: rl + rW, y2: rb + rH });
            pathSegments.push({ x1: rl, y1: rb, x2: rl, y2: rb + rH });
            pathSegments.push({ x1: rl + rW, y1: rb, x2: rl + rW, y2: rb + rH });
          } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
            argIdx += (op === OPS.curveTo) ? 6 : 4;
          } else if (op === OPS.closePath) {
            pathSegments.push({ x1: currentX, y1: currentY, x2: pathStartX, y2: pathStartY });
            currentX = pathStartX; currentY = pathStartY;
          }
        }
        break;
      }
      case OPS.stroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        commitSegments();
        break;
      case OPS.endPath:
        commitSegments();
        break;
    }
  }

  // Commit remaining segments
  commitSegments();

  await doc.destroy();
  return lines;
}

function applyVectorSnap(fields: BenchmarkField[], vectorLines: VectorLine[], maxSnapDist = 3.0): BenchmarkField[] {
  const hLines = vectorLines.filter((l) => l.isHorizontal && Math.abs(l.x2 - l.x1) > 5);

  return fields.map((field) => {
    if (!["text", "date"].includes(field.fieldType)) return field;

    const fieldBottom = field.coordinates.top + field.coordinates.height;
    const fieldLeft = field.coordinates.left;
    const fieldRight = fieldLeft + field.coordinates.width;

    let bestLine: VectorLine | null = null;
    let minDist = maxSnapDist;

    for (const line of hLines) {
      const overlapLeft = Math.max(fieldLeft, line.x1);
      const overlapRight = Math.min(fieldRight, line.x2);
      if (overlapRight - overlapLeft < field.coordinates.width * 0.5) continue;
      const dist = Math.abs(line.y1 - fieldBottom);
      if (dist < minDist) { minDist = dist; bestLine = line; }
    }

    if (bestLine) {
      const newTop = bestLine.y1 - field.coordinates.height;
      let newLeft = field.coordinates.left;
      let newWidth = field.coordinates.width;
      const lineWidth = Math.abs(bestLine.x2 - bestLine.x1);
      if (Math.abs(lineWidth - field.coordinates.width) < 8) { newLeft = bestLine.x1; newWidth = lineWidth; }
      return { ...field, coordinates: { left: Number(newLeft.toFixed(2)), top: Number(newTop.toFixed(2)), width: Number(newWidth.toFixed(2)), height: field.coordinates.height } };
    }
    return field;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[AutoForm] Script 5: Combined Pipeline Test\n");

  const pdfBuffer = loadTestPdf();
  const imageBuffer = loadRawPageImage();
  const baseline = loadGeminiBaseline();
  const benchmark = loadBenchmark();

  // ── Prepare all snap resources ──────────────────────────────────────────

  // 1. OCR words
  const OCR_CACHE_PATH = resolve(PATHS.resultsDir, "ocr/prep_questionnaire_ocr.json");
  let ocrWords: WordWithCoords[] = [];

  if (existsSync(OCR_CACHE_PATH)) {
    console.log("Loading cached OCR data...");
    const ocrResult: OcrResult = JSON.parse(readFileSync(OCR_CACHE_PATH, "utf-8"));
    const page1 = ocrResult.pages[0];
    if (page1) {
      // Try line-level words first, then fall back to page-level words
      let rawWords: OcrWord[] = [];
      for (const line of page1.lines) {
        if (line.words && line.words.length > 0) {
          rawWords.push(...line.words);
        }
      }
      if (rawWords.length === 0 && page1.words) {
        rawWords = page1.words;
      }
      for (const word of rawWords) {
        if (word.polygon.length >= 8) {
          ocrWords.push({ content: word.content, coords: polygonToCoords(word.polygon, page1.width, page1.height), confidence: word.confidence });
        }
      }
    }
    console.log(`  OCR words loaded: ${ocrWords.length}`);
  } else {
    console.log("WARNING: No cached OCR data found. Skipping OCR snap in combined pipeline.");
  }

  // 2. CV horizontal lines
  console.log("Detecting CV horizontal lines...");
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  const hLines = await detectHorizontalLines(imageBuffer);
  const hLinesPct: LinePct[] = hLines.map((l) => ({
    y: (l.y / imgHeight) * 100,
    left: (l.xStart / imgWidth) * 100,
    right: (l.xEnd / imgWidth) * 100,
    width: (l.length / imgWidth) * 100,
  }));
  console.log(`  ${hLinesPct.length} horizontal lines detected`);

  // 3. PDF vector lines
  console.log("Extracting PDF vector lines...");
  const vectorLines = await extractVectorLines(pdfBuffer, 1);
  const vectorHLines = vectorLines.filter((l) => l.isHorizontal);
  console.log(`  ${vectorHLines.length} horizontal vector lines extracted`);

  // ── Score baseline ────────────────────────────────────────────────────
  const baselineScore = scoreFields(baseline.fields, benchmark.fields);

  console.log("\n" + "═".repeat(70));
  console.log("  COMBINED PIPELINE RESULTS");
  console.log("═".repeat(70));

  printScore("Gemini Baseline", baselineScore);

  // ── Test individual approaches ────────────────────────────────────────

  type Stage = { name: string; fields: BenchmarkField[]; score: ScoreResult };
  const stages: Stage[] = [];

  // Individual: OCR only
  if (ocrWords.length > 0) {
    const ocrFields = applyOcrSnap(baseline.fields, ocrWords);
    const ocrScore = scoreFields(ocrFields, benchmark.fields);
    stages.push({ name: "OCR snap only", fields: ocrFields, score: ocrScore });
  }

  // Individual: CV only
  {
    const cvFields = applyCvSnap(baseline.fields, hLinesPct);
    const cvScore = scoreFields(cvFields, benchmark.fields);
    stages.push({ name: "CV snap only", fields: cvFields, score: cvScore });
  }

  // Individual: Vector only
  {
    const vecFields = applyVectorSnap(baseline.fields, vectorLines);
    const vecScore = scoreFields(vecFields, benchmark.fields);
    stages.push({ name: "Vector snap only", fields: vecFields, score: vecScore });
  }

  // ── Test combined pipelines ─────────────────────────────────────────

  // OCR → CV
  if (ocrWords.length > 0) {
    const step1 = applyOcrSnap(baseline.fields, ocrWords);
    const step2 = applyCvSnap(step1, hLinesPct);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "OCR → CV", fields: step2, score });
  }

  // OCR → Vector
  if (ocrWords.length > 0) {
    const step1 = applyOcrSnap(baseline.fields, ocrWords);
    const step2 = applyVectorSnap(step1, vectorLines);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "OCR → Vector", fields: step2, score });
  }

  // CV → OCR
  if (ocrWords.length > 0) {
    const step1 = applyCvSnap(baseline.fields, hLinesPct);
    const step2 = applyOcrSnap(step1, ocrWords);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "CV → OCR", fields: step2, score });
  }

  // Vector → OCR
  if (ocrWords.length > 0) {
    const step1 = applyVectorSnap(baseline.fields, vectorLines);
    const step2 = applyOcrSnap(step1, ocrWords);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "Vector → OCR", fields: step2, score });
  }

  // CV → Vector
  {
    const step1 = applyCvSnap(baseline.fields, hLinesPct);
    const step2 = applyVectorSnap(step1, vectorLines);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "CV → Vector", fields: step2, score });
  }

  // Vector → CV
  {
    const step1 = applyVectorSnap(baseline.fields, vectorLines);
    const step2 = applyCvSnap(step1, hLinesPct);
    const score = scoreFields(step2, benchmark.fields);
    stages.push({ name: "Vector → CV", fields: step2, score });
  }

  // OCR → CV → Vector
  if (ocrWords.length > 0) {
    const step1 = applyOcrSnap(baseline.fields, ocrWords);
    const step2 = applyCvSnap(step1, hLinesPct);
    const step3 = applyVectorSnap(step2, vectorLines);
    const score = scoreFields(step3, benchmark.fields);
    stages.push({ name: "OCR → CV → Vector", fields: step3, score });
  }

  // OCR → Vector → CV
  if (ocrWords.length > 0) {
    const step1 = applyOcrSnap(baseline.fields, ocrWords);
    const step2 = applyVectorSnap(step1, vectorLines);
    const step3 = applyCvSnap(step2, hLinesPct);
    const score = scoreFields(step3, benchmark.fields);
    stages.push({ name: "OCR → Vector → CV", fields: step3, score });
  }

  // ── Print comparison table ──────────────────────────────────────────

  console.log("\n" + "─".repeat(70));
  console.log("  SUMMARY TABLE");
  console.log("─".repeat(70));

  console.log(`  ${"Pipeline".padEnd(28)} ${"Avg IoU".padStart(8)} ${"Delta".padStart(8)} ${"Detection".padStart(10)} ${"Overall".padStart(9)}`);
  console.log(`  ${"─".repeat(28)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(9)}`);

  console.log(`  ${"Gemini Baseline".padEnd(28)} ${baselineScore.avgIoU.toFixed(1).padStart(7)}% ${"--".padStart(8)} ${baselineScore.detectionRate.toFixed(1).padStart(9)}% ${baselineScore.overallScore.toFixed(1).padStart(8)}%`);

  // Sort by IoU improvement
  stages.sort((a, b) => b.score.avgIoU - a.score.avgIoU);

  for (const stage of stages) {
    const delta = stage.score.avgIoU - baselineScore.avgIoU;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
    console.log(`  ${stage.name.padEnd(28)} ${stage.score.avgIoU.toFixed(1).padStart(7)}% ${deltaStr.padStart(8)} ${stage.score.detectionRate.toFixed(1).padStart(9)}% ${stage.score.overallScore.toFixed(1).padStart(8)}%`);
  }

  // ── Save best result ────────────────────────────────────────────────

  const bestStage = stages[0];
  console.log(`\n  Best pipeline: "${bestStage.name}" (avg IoU ${bestStage.score.avgIoU.toFixed(1)}%, +${(bestStage.score.avgIoU - baselineScore.avgIoU).toFixed(1)}%)`);

  saveResults("combined", "prep_questionnaire_best.json", bestStage.fields);

  // Print per-field comparison for the best pipeline
  printFieldComparison(`Best (${bestStage.name})`, baselineScore.matches, bestStage.score.matches);
}

main().catch(console.error);
