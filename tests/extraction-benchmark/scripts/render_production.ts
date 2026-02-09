#!/usr/bin/env npx tsx
/**
 * Renders production pipeline results on the page image.
 * Green = ground truth, Blue = production pipeline output.
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import {
  PATHS,
  loadBenchmark,
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
  labelBelow?: boolean,
): string {
  const x = (coords.left / 100) * imgWidth;
  const y = (coords.top / 100) * imgHeight;
  const w = (coords.width / 100) * imgWidth;
  const h = (coords.height / 100) * imgHeight;

  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" `;
  svg += `fill="${stroke}" fill-opacity="${fillOpacity}" `;
  svg += `stroke="${stroke}" stroke-width="${strokeWidth}" />`;

  if (label) {
    const fontSize = Math.max(8, Math.min(11, h * 0.6));
    const ly = labelBelow ? y + h + fontSize + 1 : y - 3;
    svg += `<text x="${x + 3}" y="${ly}" font-size="${fontSize}" fill="${stroke}" font-family="Arial" font-weight="bold">${escapeXml(label)}</text>`;
  }

  return svg;
}

async function main() {
  const productionPath = resolve(PATHS.resultsDir, "full-pipeline/prep_questionnaire_production.json");
  if (!existsSync(productionPath)) {
    console.error("Run test_full_pipeline.ts first to generate production results.");
    process.exit(1);
  }

  const production: { fields: BenchmarkField[] } = JSON.parse(readFileSync(productionPath, "utf-8"));
  const benchmark = loadBenchmark();

  const imageBuffer = readFileSync(PATHS.rawPageImage);
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  const svgParts: string[] = [];
  svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Ground truth in green
  for (const field of benchmark.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(coordsToSvgRect(coords, imgWidth, imgHeight, "#22c55e", 2, 0.08));
  }

  // Production pipeline in blue
  for (const field of production.fields) {
    const coords = getEffectiveCoords(field);
    svgParts.push(coordsToSvgRect(coords, imgWidth, imgHeight, "#3b82f6", 2.5, 0.12, field.label));

    if (field.dateSegments) {
      for (const seg of field.dateSegments) {
        svgParts.push(coordsToSvgRect(seg as Coordinates, imgWidth, imgHeight, "#2563eb", 1.5, 0.15));
      }
    }
  }

  svgParts.push("</svg>");

  const overlayImage = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svgParts.join("\n")), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const outputDir = resolve(PATHS.resultsDir, "full-pipeline");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "page1_production_overlay.png");
  writeFileSync(outputPath, overlayImage);
  console.log(`Saved: ${outputPath}`);
}

main().catch(console.error);
