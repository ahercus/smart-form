#!/usr/bin/env npx tsx
/**
 * Script 0: Debug Visualization Overlay
 *
 * Draws Gemini's extracted coordinates (red) and ground truth coordinates (green)
 * on the raw page image. Use this to visually check for systematic transform errors.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_debug_overlay.ts
 * Output: tests/extraction-benchmark/results/debug/page1_overlay.png
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import {
  loadBenchmark,
  loadGeminiBaseline,
  PATHS,
  getEffectiveCoords,
  scoreFields,
  printScore,
  type Coordinates,
  type BenchmarkField,
} from "./test_utils";

const OUTPUT_DIR = resolve(PATHS.resultsDir, "debug");

interface BoxStyle {
  stroke: string;
  strokeWidth: number;
  fillOpacity: number;
  label?: string;
}

function coordsToSvgRect(
  coords: Coordinates,
  imgWidth: number,
  imgHeight: number,
  style: BoxStyle
): string {
  const x = (coords.left / 100) * imgWidth;
  const y = (coords.top / 100) * imgHeight;
  const w = (coords.width / 100) * imgWidth;
  const h = (coords.height / 100) * imgHeight;

  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" `;
  svg += `fill="${style.stroke}" fill-opacity="${style.fillOpacity}" `;
  svg += `stroke="${style.stroke}" stroke-width="${style.strokeWidth}" />`;

  if (style.label) {
    const fontSize = Math.max(8, Math.min(12, h * 0.6));
    svg += `<text x="${x + 2}" y="${y - 2}" font-size="${fontSize}" fill="${style.stroke}" font-family="Arial">${escapeXml(style.label)}</text>`;
  }

  return svg;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  console.log("[AutoForm] Script 0: Debug Visualization Overlay\n");

  // Load data
  const benchmark = loadBenchmark();
  const baseline = loadGeminiBaseline();
  const imageBuffer = readFileSync(PATHS.rawPageImage);

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  console.log(`Page image: ${imgWidth}x${imgHeight}px`);
  console.log(`Ground truth: ${benchmark.fields.length} fields`);
  console.log(`Gemini baseline: ${baseline.fields.length} fields`);

  // Build SVG overlay
  const svgParts: string[] = [];
  svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Draw ground truth fields in GREEN (semi-transparent)
  for (const field of benchmark.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(
      coordsToSvgRect(coords, imgWidth, imgHeight, {
        stroke: "#22c55e",
        strokeWidth: 2,
        fillOpacity: 0.1,
        label: `GT: ${field.label}`,
      })
    );

    // Also draw date segments if present
    if (field.dateSegments) {
      for (const seg of field.dateSegments) {
        svgParts.push(
          coordsToSvgRect(seg, imgWidth, imgHeight, {
            stroke: "#16a34a",
            strokeWidth: 1.5,
            fillOpacity: 0.15,
          })
        );
      }
    }
  }

  // Draw Gemini predicted fields in RED (semi-transparent)
  for (const field of baseline.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(
      coordsToSvgRect(coords, imgWidth, imgHeight, {
        stroke: "#ef4444",
        strokeWidth: 2,
        fillOpacity: 0.1,
        label: `Pred: ${field.label}`,
      })
    );

    // Draw date segments if present
    if (field.dateSegments) {
      for (const seg of field.dateSegments) {
        svgParts.push(
          coordsToSvgRect(seg, imgWidth, imgHeight, {
            stroke: "#dc2626",
            strokeWidth: 1.5,
            fillOpacity: 0.15,
          })
        );
      }
    }
  }

  svgParts.push("</svg>");
  const svgStr = svgParts.join("\n");

  // Composite SVG onto image
  const svgBuffer = Buffer.from(svgStr);
  const overlayImage = await sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  // Save
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, "page1_overlay.png");
  writeFileSync(outputPath, overlayImage);
  console.log(`\nOverlay saved to: ${outputPath}`);

  // Run scoring for baseline report
  const score = scoreFields(baseline.fields, benchmark.fields);
  printScore("Gemini Baseline (flash_low_single_page_full_rails)", score);

  // Print per-field IoU details
  console.log("\n── Per-field IoU Details ──");
  console.log(`  ${"Field".padEnd(50)} ${"IoU".padStart(8)} ${"Type Match".padStart(12)}`);
  console.log(`  ${"─".repeat(50)} ${"─".repeat(8)} ${"─".repeat(12)}`);
  for (const match of score.matches) {
    const iouPct = (match.iou * 100).toFixed(1);
    const typeOk = match.typeCorrect ? "yes" : `NO (${match.predicted.fieldType} vs ${match.groundTruth.fieldType})`;
    console.log(`  ${match.groundTruth.label.padEnd(50)} ${iouPct.padStart(8)} ${typeOk.padStart(12)}`);
  }

  if (score.missed.length > 0) {
    console.log("\n  Missed fields:");
    for (const f of score.missed) {
      console.log(`    - ${f.label} (${f.fieldType})`);
    }
  }

  if (score.extra.length > 0) {
    console.log("\n  Extra predictions:");
    for (const f of score.extra) {
      console.log(`    - ${f.label} (${f.fieldType})`);
    }
  }

  // Compute per-field offset analysis
  console.log("\n── Offset Analysis (Pred - Truth) ──");
  console.log(`  ${"Field".padEnd(50)} ${"dLeft".padStart(7)} ${"dTop".padStart(7)} ${"dWidth".padStart(7)} ${"dHeight".padStart(7)}`);
  console.log(`  ${"─".repeat(50)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)}`);

  const offsets = { left: [] as number[], top: [] as number[], width: [] as number[], height: [] as number[] };

  for (const match of score.matches) {
    const pc = getEffectiveCoords(match.predicted);
    const tc = getEffectiveCoords(match.groundTruth);
    const dL = pc.left - tc.left;
    const dT = pc.top - tc.top;
    const dW = pc.width - tc.width;
    const dH = pc.height - tc.height;

    offsets.left.push(dL);
    offsets.top.push(dT);
    offsets.width.push(dW);
    offsets.height.push(dH);

    console.log(
      `  ${match.groundTruth.label.padEnd(50)} ${dL.toFixed(2).padStart(7)} ${dT.toFixed(2).padStart(7)} ${dW.toFixed(2).padStart(7)} ${dH.toFixed(2).padStart(7)}`
    );
  }

  // Summary statistics
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = (arr: number[]) => {
    const m = avg(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };

  console.log(`\n  ${"MEAN".padEnd(50)} ${avg(offsets.left).toFixed(2).padStart(7)} ${avg(offsets.top).toFixed(2).padStart(7)} ${avg(offsets.width).toFixed(2).padStart(7)} ${avg(offsets.height).toFixed(2).padStart(7)}`);
  console.log(`  ${"STD DEV".padEnd(50)} ${stddev(offsets.left).toFixed(2).padStart(7)} ${stddev(offsets.top).toFixed(2).padStart(7)} ${stddev(offsets.width).toFixed(2).padStart(7)} ${stddev(offsets.height).toFixed(2).padStart(7)}`);

  const meanLeft = avg(offsets.left);
  const meanTop = avg(offsets.top);
  if (Math.abs(meanLeft) > 1.0 || Math.abs(meanTop) > 1.0) {
    console.log(`\n  ⚠ SYSTEMATIC OFFSET DETECTED: mean left=${meanLeft.toFixed(2)}%, mean top=${meanTop.toFixed(2)}%`);
    console.log(`    This suggests a transform bug in the pipeline.`);
  } else {
    console.log(`\n  No significant systematic offset detected (mean < 1%).`);
    console.log(`  Errors appear to be per-field estimation variance.`);
  }
}

main().catch(console.error);
