#!/usr/bin/env npx tsx
/**
 * Script 4: CV Line Snapping Test
 *
 * Detects horizontal lines in the page image and snaps Gemini field bottoms
 * to them. Also detects vertical lines and small rectangles (checkboxes).
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_cv_snap.ts
 */

import sharp from "sharp";
import {
  loadBenchmark,
  loadGeminiBaseline,
  loadRawPageImage,
  saveResults,
  scoreFields,
  printScore,
  printScoreComparison,
  printFieldComparison,
  type BenchmarkField,
  type Coordinates,
} from "./test_utils";

// ─── Line Detection ─────────────────────────────────────────────────────────

interface Line {
  y: number;       // pixel row
  xStart: number;  // pixel col start
  xEnd: number;    // pixel col end
  length: number;  // pixel length
}

interface LinePct {
  y: number;
  left: number;
  right: number;
  width: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Detect horizontal lines in a grayscale image.
 */
async function detectHorizontalLines(
  imageBuffer: Buffer,
  options = { threshold: 200, minLengthPct: 2, mergeDistance: 5 }
): Promise<Line[]> {
  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

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

/**
 * Detect vertical lines in a grayscale image.
 */
async function detectVerticalLines(
  imageBuffer: Buffer,
  options = { threshold: 200, minLengthPct: 2, mergeDistance: 5 }
): Promise<Line[]> {
  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const minLineLength = height * (options.minLengthPct / 100);
  const lines: Line[] = [];

  for (let x = 0; x < width; x++) {
    let currentStart = -1;
    let consecutiveDark = 0;

    for (let y = 0; y < height; y++) {
      const pixelValue = data[y * width * channels + x * channels];

      if (pixelValue < options.threshold) {
        if (currentStart === -1) currentStart = y;
        consecutiveDark++;
      } else {
        if (currentStart !== -1 && consecutiveDark > minLineLength) {
          // Store as vertical line: "y" is x position, xStart/xEnd are y positions
          lines.push({ y: x, xStart: currentStart, xEnd: y, length: consecutiveDark });
        }
        currentStart = -1;
        consecutiveDark = 0;
      }
    }

    if (currentStart !== -1 && consecutiveDark > minLineLength) {
      lines.push({ y: x, xStart: currentStart, xEnd: height, length: consecutiveDark });
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
    if (
      next.y - current.y < mergeDistance &&
      Math.max(current.xStart, next.xStart) < Math.min(current.xEnd, next.xEnd)
    ) {
      const minX = Math.min(current.xStart, next.xStart);
      const maxX = Math.max(current.xEnd, next.xEnd);
      current = {
        y: Math.round((current.y + next.y) / 2),
        xStart: minX,
        xEnd: maxX,
        length: maxX - minX,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

// ─── Snapping Logic ─────────────────────────────────────────────────────────

interface SnapResult {
  fields: BenchmarkField[];
  snappedCount: number;
  snapDetails: { label: string; type: string; snapped: boolean; snapDist?: number }[];
}

function snapFieldsToDetectedLines(
  fields: BenchmarkField[],
  hLines: LinePct[],
  imgWidth: number,
  imgHeight: number,
  maxSnapDistPct: number = 3.0
): SnapResult {
  const snapDetails: SnapResult["snapDetails"] = [];
  let snappedCount = 0;

  const snappedFields = fields.map((field) => {
    // Only snap text-like fields (not checkboxes, tables, textareas)
    if (!["text", "date", "linkedDate"].includes(field.fieldType)) {
      snapDetails.push({ label: field.label, type: field.fieldType, snapped: false });
      return field;
    }

    const fieldBottom = field.coordinates.top + field.coordinates.height;
    const fieldLeft = field.coordinates.left;
    const fieldRight = field.coordinates.left + field.coordinates.width;

    // Find closest horizontal line near the field's bottom
    let bestLine: LinePct | null = null;
    let minDist = maxSnapDistPct;

    for (const line of hLines) {
      // Check horizontal overlap
      const overlapLeft = Math.max(fieldLeft, line.left);
      const overlapRight = Math.min(fieldRight, line.right);
      if (overlapRight <= overlapLeft) continue;

      // Overlap must be at least 50% of the field width
      const overlapWidth = overlapRight - overlapLeft;
      if (overlapWidth < field.coordinates.width * 0.5) continue;

      const dist = Math.abs(line.y - fieldBottom);
      if (dist < minDist) {
        minDist = dist;
        bestLine = line;
      }
    }

    if (bestLine) {
      snappedCount++;
      const newTop = bestLine.y - field.coordinates.height;

      // Also snap left/width if line extent closely matches
      let newLeft = field.coordinates.left;
      let newWidth = field.coordinates.width;

      const lineFitsDifference = Math.abs(bestLine.width - field.coordinates.width);
      if (lineFitsDifference < 8) {
        newLeft = bestLine.left;
        newWidth = bestLine.width;
      }

      snapDetails.push({
        label: field.label,
        type: field.fieldType,
        snapped: true,
        snapDist: minDist,
      });

      return {
        ...field,
        coordinates: {
          left: Number(newLeft.toFixed(2)),
          top: Number(newTop.toFixed(2)),
          width: Number(newWidth.toFixed(2)),
          height: field.coordinates.height,
        },
      };
    }

    snapDetails.push({ label: field.label, type: field.fieldType, snapped: false });
    return field;
  });

  return { fields: snappedFields, snappedCount, snapDetails };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[AutoForm] Script 4: CV Line Snapping Test\n");

  const imageBuffer = loadRawPageImage();
  const baseline = loadGeminiBaseline();
  const benchmark = loadBenchmark();

  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  console.log(`Image: ${imgWidth}x${imgHeight}px`);

  // Detect horizontal lines
  console.log("\nDetecting horizontal lines...");
  const hLines = await detectHorizontalLines(imageBuffer);
  console.log(`Found ${hLines.length} horizontal lines`);

  // Convert to percentage coordinates
  const hLinesPct: LinePct[] = hLines.map((l) => ({
    y: (l.y / imgHeight) * 100,
    left: (l.xStart / imgWidth) * 100,
    right: (l.xEnd / imgWidth) * 100,
    width: (l.length / imgWidth) * 100,
  }));

  // Print detected lines
  console.log("\n── Detected Horizontal Lines ──");
  for (const line of hLinesPct) {
    console.log(`  y=${line.y.toFixed(1)}%  left=${line.left.toFixed(1)}%  right=${line.right.toFixed(1)}%  width=${line.width.toFixed(1)}%`);
  }

  // Detect vertical lines
  console.log("\nDetecting vertical lines...");
  const vLines = await detectVerticalLines(imageBuffer);
  console.log(`Found ${vLines.length} vertical lines`);

  // Print vertical lines
  console.log("\n── Detected Vertical Lines ──");
  const vLinesPct = vLines.map((l) => ({
    x: (l.y / imgWidth) * 100,
    top: (l.xStart / imgHeight) * 100,
    bottom: (l.xEnd / imgHeight) * 100,
    height: (l.length / imgHeight) * 100,
  }));
  for (const line of vLinesPct) {
    console.log(`  x=${line.x.toFixed(1)}%  top=${line.top.toFixed(1)}%  bottom=${line.bottom.toFixed(1)}%  height=${line.height.toFixed(1)}%`);
  }

  // Score baseline
  const baselineScore = scoreFields(baseline.fields, benchmark.fields);
  printScore("Gemini Baseline", baselineScore);

  // Snap and score
  const snapResult = snapFieldsToDetectedLines(
    baseline.fields,
    hLinesPct,
    imgWidth,
    imgHeight
  );

  console.log(`\nSnapped ${snapResult.snappedCount}/${baseline.fields.length} fields`);
  console.log("\n── Snap Details ──");
  for (const detail of snapResult.snapDetails) {
    const status = detail.snapped
      ? `SNAPPED (${detail.snapDist!.toFixed(2)}% dist)`
      : `not snapped (${detail.type})`;
    console.log(`  ${detail.label.padEnd(50)} ${status}`);
  }

  saveResults("cv_snap", "prep_questionnaire_snapped.json", snapResult.fields);

  const snappedScore = scoreFields(snapResult.fields, benchmark.fields);
  printScore("After CV Line Snapping", snappedScore);
  printScoreComparison(baselineScore, snappedScore);
  printFieldComparison("CV Snap", baselineScore.matches, snappedScore.matches);

  // Generate overlay with detected lines + snapped coords
  await generateOverlay(imageBuffer, imgWidth, imgHeight, hLinesPct, baseline.fields, snapResult.fields, benchmark.fields);
}

async function generateOverlay(
  imageBuffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  hLines: LinePct[],
  originalFields: BenchmarkField[],
  snappedFields: BenchmarkField[],
  groundTruth: BenchmarkField[]
) {
  const svgParts: string[] = [];
  svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Draw detected lines in BLUE
  for (const line of hLines) {
    const y = (line.y / 100) * imgHeight;
    const x1 = (line.left / 100) * imgWidth;
    const x2 = (line.right / 100) * imgWidth;
    svgParts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#3b82f6" stroke-width="2" opacity="0.7"/>`);
  }

  // Draw ground truth in GREEN
  for (const field of groundTruth) {
    const c = field.tableConfig?.coordinates ?? field.coordinates;
    const x = (c.left / 100) * imgWidth;
    const y = (c.top / 100) * imgHeight;
    const w = (c.width / 100) * imgWidth;
    const h = (c.height / 100) * imgHeight;
    svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#22c55e" stroke-width="2" opacity="0.6"/>`);
  }

  // Draw snapped fields in ORANGE
  for (const field of snappedFields) {
    const c = field.tableConfig?.coordinates ?? field.coordinates;
    const x = (c.left / 100) * imgWidth;
    const y = (c.top / 100) * imgHeight;
    const w = (c.width / 100) * imgWidth;
    const h = (c.height / 100) * imgHeight;
    svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="4" opacity="0.8"/>`);
  }

  svgParts.push("</svg>");

  const overlay = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svgParts.join("\n")), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const { writeFileSync, mkdirSync, existsSync } = await import("fs");
  const { resolve } = await import("path");
  const dir = resolve(process.cwd(), "tests/extraction-benchmark/results/cv_snap");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const outputPath = resolve(dir, "page1_cv_overlay.png");
  writeFileSync(outputPath, overlay);
  console.log(`\nCV overlay saved to: ${outputPath}`);
}

main().catch(console.error);
