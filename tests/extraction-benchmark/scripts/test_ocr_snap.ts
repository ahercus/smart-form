#!/usr/bin/env npx tsx
/**
 * Script 3: OCR Anchor Snapping Test
 *
 * Uses Azure Document Intelligence word-level bounding polygons to precisely
 * locate field labels, then deterministically compute input area positions.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_ocr_snap.ts
 *
 * Requires env vars:
 *   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
 *   AZURE_DOCUMENT_INTELLIGENCE_KEY
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
  loadBenchmark,
  loadGeminiBaseline,
  loadTestPdf,
  saveResults,
  scoreFields,
  printScore,
  printScoreComparison,
  printFieldComparison,
  PATHS,
  type BenchmarkField,
  type Coordinates,
} from "./test_utils";

// ─── Azure OCR Types ────────────────────────────────────────────────────────

interface OcrWord {
  content: string;
  polygon: number[]; // [x1,y1, x2,y2, x3,y3, x4,y4] in page units
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

// ─── Azure API ──────────────────────────────────────────────────────────────

const AZURE_ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const AZURE_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
const OCR_CACHE_PATH = resolve(PATHS.resultsDir, "ocr/prep_questionnaire_ocr.json");

async function runAzureOcr(pdfBuffer: Buffer): Promise<OcrResult> {
  // Check cache first
  if (existsSync(OCR_CACHE_PATH)) {
    console.log("Loading cached OCR result...");
    return JSON.parse(readFileSync(OCR_CACHE_PATH, "utf-8"));
  }

  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    throw new Error(
      "Missing AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or AZURE_DOCUMENT_INTELLIGENCE_KEY env vars"
    );
  }

  console.log("Calling Azure Document Intelligence...");
  const analyzeUrl = `${AZURE_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;

  const submitResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/pdf",
    },
    body: pdfBuffer as unknown as BodyInit,
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Azure API error: ${submitResponse.status} - ${errorText}`);
  }

  const operationLocation = submitResponse.headers.get("Operation-Location");
  if (!operationLocation) throw new Error("No Operation-Location header");

  // Poll for results
  let result: any = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));

    const pollResponse = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY },
    });

    result = await pollResponse.json();
    if (result.status === "succeeded") break;
    if (result.status === "failed") throw new Error("Azure analysis failed");
    process.stdout.write(".");
  }
  console.log();

  if (!result?.analyzeResult) throw new Error("No analyze result");

  // Extract page data with word-level polygons
  const ocrResult: OcrResult = {
    pages: (result.analyzeResult.pages || []).map((page: any) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      unit: page.unit || "inch",
      lines: (page.lines || []).map((line: any) => ({
        content: line.content,
        polygon: line.polygon || [],
        words: (line.words || []).map((word: any) => ({
          content: word.content,
          polygon: word.polygon || [],
          confidence: word.confidence || 0,
        })),
      })),
      words: (page.words || []).map((word: any) => ({
        content: word.content,
        polygon: word.polygon || [],
        confidence: word.confidence || 0,
      })),
    })),
  };

  // Cache the result
  const cacheDir = resolve(PATHS.resultsDir, "ocr");
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  writeFileSync(OCR_CACHE_PATH, JSON.stringify(ocrResult, null, 2));
  console.log(`OCR result cached to: ${OCR_CACHE_PATH}`);

  return ocrResult;
}

// ─── Polygon to Coordinates ─────────────────────────────────────────────────

/**
 * Convert an Azure polygon (4 corners: [x1,y1, x2,y2, x3,y3, x4,y4])
 * to normalized percentage coordinates.
 */
function polygonToCoords(
  polygon: number[],
  pageWidth: number,
  pageHeight: number
): Coordinates {
  if (polygon.length < 8) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  // Polygon corners: top-left, top-right, bottom-right, bottom-left
  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    left: (minX / pageWidth) * 100,
    top: (minY / pageHeight) * 100,
    width: ((maxX - minX) / pageWidth) * 100,
    height: ((maxY - minY) / pageHeight) * 100,
  };
}

// ─── Label Matching ─────────────────────────────────────────────────────────

interface WordWithCoords {
  content: string;
  coords: Coordinates;
  confidence: number;
}

interface LabelMatch {
  label: string;
  matchedWords: WordWithCoords[];
  labelCoords: Coordinates; // Bounding box of matched words
  confidence: number;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s'/-]/g, "")
    .trim();
}

/**
 * Find consecutive OCR words that match a field label.
 * Returns the bounding box of the matched word sequence.
 */
function matchLabelToOcrWords(
  label: string,
  words: WordWithCoords[],
  geminiCoords: Coordinates
): LabelMatch | null {
  const normLabel = normalizeText(label);
  const labelTokens = normLabel.split(/\s+/).filter(Boolean);

  if (labelTokens.length === 0) return null;

  type Candidate = { startIdx: number; endIdx: number; score: number };
  const candidates: Candidate[] = [];

  // Sliding window: try to find consecutive words that match the label tokens
  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    // Try matching starting from this word
    let matchedTokens = 0;
    let endIdx = startIdx;
    let tokenIdx = 0;

    while (endIdx < words.length && tokenIdx < labelTokens.length) {
      const wordNorm = normalizeText(words[endIdx].content);

      // Check if this word matches the current label token
      if (wordNorm === labelTokens[tokenIdx]) {
        matchedTokens++;
        tokenIdx++;
        endIdx++;
      } else if (labelTokens[tokenIdx].includes(wordNorm) || wordNorm.includes(labelTokens[tokenIdx])) {
        // Partial match (e.g., "child's" vs "childs")
        matchedTokens += 0.8;
        tokenIdx++;
        endIdx++;
      } else {
        break;
      }
    }

    if (matchedTokens >= labelTokens.length * 0.6) {
      // Score based on token coverage and proximity to Gemini coords
      const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
      const proximity = 1 / (1 + coordDistance(matchedBox, geminiCoords));
      const coverage = matchedTokens / labelTokens.length;
      const score = 0.6 * coverage + 0.4 * proximity;

      candidates.push({ startIdx, endIdx, score });
    }
  }

  // Also try matching the full label as a substring of joined consecutive words
  for (let startIdx = 0; startIdx < words.length; startIdx++) {
    for (let windowSize = 1; windowSize <= Math.min(labelTokens.length + 2, words.length - startIdx); windowSize++) {
      const endIdx = startIdx + windowSize;
      const joinedWords = words
        .slice(startIdx, endIdx)
        .map((w) => normalizeText(w.content))
        .join(" ");

      const similarity = stringSimilarity(normLabel, joinedWords);
      if (similarity > 0.7) {
        const matchedBox = boundingBoxOfWords(words.slice(startIdx, endIdx));
        const proximity = 1 / (1 + coordDistance(matchedBox, geminiCoords));
        const score = 0.5 * similarity + 0.5 * proximity;

        // Check if this candidate already exists
        const exists = candidates.some((c) => c.startIdx === startIdx && c.endIdx === endIdx);
        if (!exists) {
          candidates.push({ startIdx, endIdx, score });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick best candidate
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const matchedWords = words.slice(best.startIdx, best.endIdx);
  const labelCoords = boundingBoxOfWords(matchedWords);

  return {
    label,
    matchedWords,
    labelCoords,
    confidence: best.score,
  };
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
  const aCx = a.left + a.width / 2;
  const aCy = a.top + a.height / 2;
  const bCx = b.left + b.width / 2;
  const bCy = b.top + b.height / 2;
  return Math.sqrt((aCx - bCx) ** 2 + (aCy - bCy) ** 2);
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Simple Levenshtein
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
  }

  return 1 - matrix[a.length][b.length] / maxLen;
}

// ─── Input Area Inference ───────────────────────────────────────────────────

/**
 * Conservative OCR snapping: use OCR label position as a LEFT BOUNDARY
 * constraint only. Fixes Gemini's tendency to overlap label text.
 *
 * Safety rules:
 * 1. Only snap inline text fields (not textarea, checkbox, table, linkedDate)
 * 2. Only push field right if label is shorter than the field (label doesn't
 *    extend past the field's right edge — otherwise label IS the field)
 * 3. Only snap if the shift is less than 10% (not a huge correction)
 * 4. Resulting width must be at least 60% of original width
 * 5. Use OCR top for vertical alignment if on the same line
 */
function computeSnappedCoords(
  labelMatch: LabelMatch,
  geminiField: BenchmarkField,
  allLabels: LabelMatch[]
): Coordinates {
  const labelBox = labelMatch.labelCoords;
  const geminiCoords = geminiField.coordinates;

  const labelRight = labelBox.left + labelBox.width;
  const geminiRight = geminiCoords.left + geminiCoords.width;

  // Same-line check: label top within 3% of field top
  const isSameLine = Math.abs(labelBox.top - geminiCoords.top) < 3;

  // Safety: label must be SHORTER than the field (label is to the left, not spanning the field)
  const labelShorterThanField = labelRight < geminiRight - 2;

  // Overlap check: Gemini's field starts before label ends
  const isOverlapping = geminiCoords.left < labelRight;

  // Shift magnitude check
  const shiftAmount = labelRight - geminiCoords.left;

  if (isSameLine && isOverlapping && labelShorterThanField && shiftAmount > 0 && shiftAmount < 10) {
    // SAFE INLINE SNAP: push field.left to label right edge, keep right edge
    const newLeft = labelRight;
    const newWidth = geminiRight - newLeft;

    // Check resulting width is reasonable
    if (newWidth < geminiCoords.width * 0.6) {
      // Too much width lost — skip snap
      return geminiCoords;
    }

    // Only snap LEFT — keep Gemini's top (OCR label top != field input top)
    return {
      left: Number(newLeft.toFixed(2)),
      top: geminiCoords.top,
      width: Number(newWidth.toFixed(2)),
      height: geminiCoords.height,
    };
  }

  // Not same-line or safety checks failed — return unchanged
  return geminiCoords;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[AutoForm] Script 3: OCR Anchor Snapping Test\n");

  // Load data
  const pdfBuffer = loadTestPdf();
  const baseline = loadGeminiBaseline();
  const benchmark = loadBenchmark();

  // Get OCR data
  const ocrResult = await runAzureOcr(pdfBuffer);
  const page1 = ocrResult.pages[0];
  if (!page1) {
    console.error("No page 1 data from OCR");
    return;
  }

  console.log(`OCR page 1: ${page1.width}x${page1.height} ${page1.unit}`);
  console.log(`OCR lines: ${page1.lines.length}`);

  // Build word list with normalized coordinates
  const allWords: WordWithCoords[] = [];

  for (const line of page1.lines) {
    for (const word of line.words) {
      if (word.polygon.length >= 8) {
        allWords.push({
          content: word.content,
          coords: polygonToCoords(word.polygon, page1.width, page1.height),
          confidence: word.confidence,
        });
      }
    }
  }

  // If words aren't in lines, use page-level words
  if (allWords.length === 0 && page1.words) {
    for (const word of page1.words) {
      if (word.polygon.length >= 8) {
        allWords.push({
          content: word.content,
          coords: polygonToCoords(word.polygon, page1.width, page1.height),
          confidence: word.confidence,
        });
      }
    }
  }

  console.log(`OCR words with polygons: ${allWords.length}`);

  // Print first 20 words for verification
  console.log("\n── First 20 OCR words with coordinates ──");
  for (const word of allWords.slice(0, 20)) {
    console.log(
      `  "${word.content.padEnd(20)}" left=${word.coords.left.toFixed(1)}% top=${word.coords.top.toFixed(1)}% w=${word.coords.width.toFixed(1)}% h=${word.coords.height.toFixed(1)}% conf=${word.confidence.toFixed(2)}`
    );
  }

  // Score baseline
  const baselineScore = scoreFields(baseline.fields, benchmark.fields);
  printScore("Gemini Baseline", baselineScore);

  // Match each Gemini field label to OCR words
  console.log("\n── Label Matching ──");
  const labelMatches: Map<number, LabelMatch> = new Map();
  const allLabelMatches: LabelMatch[] = [];

  for (let i = 0; i < baseline.fields.length; i++) {
    const field = baseline.fields[i];
    const effectiveCoords = field.tableConfig?.coordinates ?? field.coordinates ?? { left: 50, top: 50, width: 10, height: 2 };
    const match = matchLabelToOcrWords(field.label, allWords, effectiveCoords);

    if (match) {
      labelMatches.set(i, match);
      allLabelMatches.push(match);
      const matchedText = match.matchedWords.map((w) => w.content).join(" ");
      console.log(
        `  ✓ "${field.label}" → "${matchedText}" ` +
          `at left=${match.labelCoords.left.toFixed(1)}% top=${match.labelCoords.top.toFixed(1)}% ` +
          `(conf=${match.confidence.toFixed(2)})`
      );
    } else {
      console.log(`  ✗ "${field.label}" → NO MATCH`);
    }
  }

  console.log(`\nMatched ${labelMatches.size}/${baseline.fields.length} labels`);

  // Apply OCR snapping
  const snappedFields = baseline.fields.map((field, i) => {
    const match = labelMatches.get(i);
    if (!match) return field;

    // Skip special types that need different handling
    if (["checkbox", "table", "linkedDate", "textarea"].includes(field.fieldType)) {
      return field;
    }

    const snappedCoords = computeSnappedCoords(match, field, allLabelMatches);

    // Sanity check: don't make things worse
    // Keep the snap if coordinates are reasonable
    if (
      snappedCoords.left < 0 || snappedCoords.top < 0 ||
      snappedCoords.left + snappedCoords.width > 100 ||
      snappedCoords.top + snappedCoords.height > 100 ||
      snappedCoords.width < 2 || snappedCoords.height < 0.5
    ) {
      console.log(`  Skipping snap for "${field.label}" (out of bounds)`);
      return field;
    }

    return { ...field, coordinates: snappedCoords };
  });

  saveResults("ocr_snap", "prep_questionnaire_snapped.json", snappedFields);

  // Score snapped result
  const snappedScore = scoreFields(snappedFields, benchmark.fields);
  printScore("After OCR Anchor Snapping", snappedScore);
  printScoreComparison(baselineScore, snappedScore);
  printFieldComparison("OCR Snap", baselineScore.matches, snappedScore.matches);

  // Print what changed
  console.log("\n── Coordinate Changes ──");
  for (let i = 0; i < baseline.fields.length; i++) {
    const orig = baseline.fields[i].tableConfig?.coordinates ?? baseline.fields[i].coordinates;
    const snap = snappedFields[i].tableConfig?.coordinates ?? snappedFields[i].coordinates;
    if (!orig || !snap) continue;
    if (orig.left !== snap.left || orig.top !== snap.top || orig.width !== snap.width) {
      console.log(
        `  ${baseline.fields[i].label}:` +
          `\n    Before: left=${orig.left.toFixed(1)} top=${orig.top.toFixed(1)} w=${orig.width.toFixed(1)} h=${orig.height.toFixed(1)}` +
          `\n    After:  left=${snap.left.toFixed(1)} top=${snap.top.toFixed(1)} w=${snap.width.toFixed(1)} h=${snap.height.toFixed(1)}`
      );
    }
  }
}

main().catch(console.error);
