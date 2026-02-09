#!/usr/bin/env npx tsx
/**
 * Renders an overlay comparing Ground Truth (green), Gemini Baseline (red),
 * and Combined Pipeline output (blue) on the page image.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/render_combined_overlay.ts
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import {
  loadBenchmark,
  loadGeminiBaseline,
  PATHS,
  getEffectiveCoords,
  type Coordinates,
  type BenchmarkField,
} from "./test_utils";

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function coordsToSvgRect(
  coords: Coordinates,
  imgWidth: number,
  imgHeight: number,
  stroke: string,
  strokeWidth: number,
  fillOpacity: number,
  label?: string,
  dashArray?: string,
): string {
  const x = (coords.left / 100) * imgWidth;
  const y = (coords.top / 100) * imgHeight;
  const w = (coords.width / 100) * imgWidth;
  const h = (coords.height / 100) * imgHeight;

  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" `;
  svg += `fill="${stroke}" fill-opacity="${fillOpacity}" `;
  svg += `stroke="${stroke}" stroke-width="${strokeWidth}"`;
  if (dashArray) svg += ` stroke-dasharray="${dashArray}"`;
  svg += ` />`;

  if (label) {
    const fontSize = Math.max(8, Math.min(11, h * 0.5));
    svg += `<text x="${x + 2}" y="${y - 2}" font-size="${fontSize}" fill="${stroke}" font-family="Arial" font-weight="bold">${escapeXml(label)}</text>`;
  }

  return svg;
}

async function main() {
  console.log("[AutoForm] Combined Pipeline Overlay\n");

  const benchmark = loadBenchmark();
  const baseline = loadGeminiBaseline();

  // Load combined pipeline result
  const combinedPath = resolve(PATHS.resultsDir, "combined/prep_questionnaire_best.json");
  if (!existsSync(combinedPath)) {
    console.error("Combined result not found. Run test_combined.ts first.");
    return;
  }
  const combined: { fields: BenchmarkField[] } = JSON.parse(readFileSync(combinedPath, "utf-8"));

  const imageBuffer = readFileSync(PATHS.rawPageImage);
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;
  console.log(`Page image: ${imgWidth}x${imgHeight}px`);

  const svgParts: string[] = [];
  svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Legend
  const legendY = 10;
  svgParts.push(`<rect x="10" y="${legendY}" width="280" height="70" fill="white" fill-opacity="0.85" rx="5" />`);
  svgParts.push(`<rect x="20" y="${legendY + 10}" width="20" height="10" fill="#22c55e" fill-opacity="0.5" stroke="#22c55e" stroke-width="2" />`);
  svgParts.push(`<text x="48" y="${legendY + 20}" font-size="12" fill="#333" font-family="Arial" font-weight="bold">Ground Truth</text>`);
  svgParts.push(`<rect x="20" y="${legendY + 28}" width="20" height="10" fill="#ef4444" fill-opacity="0.3" stroke="#ef4444" stroke-width="2" />`);
  svgParts.push(`<text x="48" y="${legendY + 38}" font-size="12" fill="#333" font-family="Arial" font-weight="bold">Gemini Baseline (67.8% IoU)</text>`);
  svgParts.push(`<rect x="20" y="${legendY + 46}" width="20" height="10" fill="#3b82f6" fill-opacity="0.3" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4" />`);
  svgParts.push(`<text x="48" y="${legendY + 56}" font-size="12" fill="#333" font-family="Arial" font-weight="bold">Combined Pipeline (79.1% IoU)</text>`);

  // 1. Ground truth in GREEN
  for (const field of benchmark.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(coordsToSvgRect(coords, imgWidth, imgHeight, "#22c55e", 2.5, 0.08));

    if (field.dateSegments) {
      for (const seg of field.dateSegments) {
        svgParts.push(coordsToSvgRect(seg, imgWidth, imgHeight, "#16a34a", 1.5, 0.12));
      }
    }
  }

  // 2. Gemini baseline in RED
  for (const field of baseline.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(coordsToSvgRect(coords, imgWidth, imgHeight, "#ef4444", 2, 0.06));
  }

  // 3. Combined pipeline in BLUE (dashed)
  for (const field of combined.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(coordsToSvgRect(coords, imgWidth, imgHeight, "#3b82f6", 2.5, 0.08, undefined, "6,3"));
  }

  svgParts.push("</svg>");

  const overlayImage = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svgParts.join("\n")), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const outputDir = resolve(PATHS.resultsDir, "combined");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "page1_combined_overlay.png");
  writeFileSync(outputPath, overlayImage);
  console.log(`Overlay saved to: ${outputPath}`);
}

main().catch(console.error);
