#!/usr/bin/env npx tsx
/**
 * Script 2: PDF.js Vector Geometry Extraction
 *
 * Extracts lines, rectangles, and text positions from PDF drawing commands
 * using pdfjs-dist's operator list. Then snaps Gemini field coordinates
 * to the detected geometry.
 *
 * Usage: npx tsx tests/extraction-benchmark/scripts/test_pdf_vectors.ts
 */

import { readFileSync } from "fs";
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface VectorLine {
  x1: number; y1: number; // Start (percentage)
  x2: number; y2: number; // End (percentage)
  isHorizontal: boolean;
  isVertical: boolean;
}

interface VectorRect {
  left: number; top: number; width: number; height: number; // Percentages
}

interface VectorText {
  text: string;
  left: number; top: number; width: number; height: number; // Percentages
}

interface PageGeometry {
  lines: VectorLine[];
  rects: VectorRect[];
  texts: VectorText[];
  pageWidth: number;
  pageHeight: number;
}

// ─── PDF.js Loading ─────────────────────────────────────────────────────────

async function extractPageGeometry(pdfBuffer: Buffer, pageNumber: number): Promise<PageGeometry> {
  // Dynamic import for pdfjs-dist (ESM)
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(pageNumber);

  const viewport = page.getViewport({ scale: 1.0 });
  const pageWidth = viewport.width;  // In PDF points
  const pageHeight = viewport.height;

  console.log(`PDF page ${pageNumber}: ${pageWidth.toFixed(1)}x${pageHeight.toFixed(1)} points`);

  // ── Extract text content (simple, reliable) ──
  const textContent = await page.getTextContent();
  const texts: VectorText[] = [];

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const tx = item.transform;
    // transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
    const x = tx[4];
    const y = tx[5];
    const w = item.width;
    const h = Math.abs(tx[3]); // scaleY = font size

    texts.push({
      text: item.str,
      left: (x / pageWidth) * 100,
      top: ((pageHeight - y - h) / pageHeight) * 100,
      width: (w / pageWidth) * 100,
      height: (h / pageHeight) * 100,
    });
  }

  // ── Extract operator list for geometry ──
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  const lines: VectorLine[] = [];
  const rects: VectorRect[] = [];

  // CTM stack for tracking coordinate transforms
  const ctmStack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0]; // Identity matrix

  // Current path tracking
  let currentX = 0, currentY = 0;
  let pathStartX = 0, pathStartY = 0;
  const pathSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];

  function transformPoint(x: number, y: number): [number, number] {
    return [
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5],
    ];
  }

  function toPercentX(x: number): number { return (x / pageWidth) * 100; }
  function toPercentY(y: number): number { return ((pageHeight - y) / pageHeight) * 100; }

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save:
        ctmStack.push([...ctm]);
        break;

      case OPS.restore:
        if (ctmStack.length > 0) ctm = ctmStack.pop()!;
        break;

      case OPS.transform: {
        // Multiply current CTM by new transform
        const [a, b, c, d, e, f] = args;
        const newCtm = [
          ctm[0] * a + ctm[2] * b,
          ctm[1] * a + ctm[3] * b,
          ctm[0] * c + ctm[2] * d,
          ctm[1] * c + ctm[3] * d,
          ctm[0] * e + ctm[2] * f + ctm[4],
          ctm[1] * e + ctm[3] * f + ctm[5],
        ];
        ctm = newCtm;
        break;
      }

      case OPS.constructPath: {
        // args[0] = ops array, args[1] = flat args array
        // In some pdfjs versions, args may be structured differently
        const ops = args[0];
        const pathArgs = args[1];

        if (!Array.isArray(ops)) {
          // In newer pdfjs-dist, constructPath has different arg format:
          // args = [opCode, [{0: subOp, 1: x, 2: y, 3: subOp, 4: x, 5: y, ...}, ...], minMax]
          // Each element of args[1] is an object-with-numeric-keys containing a flat sequence of sub-ops + coords
          const subOpObjs = pathArgs;
          if (Array.isArray(subOpObjs)) {
            for (const obj of subOpObjs) {
              // Convert object with numeric keys to flat array
              const flat: number[] = [];
              let k = 0;
              while (obj[k] !== undefined) {
                flat.push(obj[k]);
                k++;
              }

              // Parse flat array: opCode, [coords...], opCode, [coords...], ...
              let fi = 0;
              while (fi < flat.length) {
                const opCode = flat[fi];
                fi++;
                if (opCode === 0) { // moveTo(x, y)
                  const [tx, ty] = transformPoint(flat[fi], flat[fi + 1]);
                  currentX = tx; currentY = ty;
                  pathStartX = tx; pathStartY = ty;
                  fi += 2;
                } else if (opCode === 1) { // lineTo(x, y)
                  const [tx, ty] = transformPoint(flat[fi], flat[fi + 1]);
                  pathSegments.push({ x1: currentX, y1: currentY, x2: tx, y2: ty });
                  currentX = tx; currentY = ty;
                  fi += 2;
                } else if (opCode === 2) { // curveTo(x1,y1,x2,y2,x3,y3)
                  fi += 6;
                } else if (opCode === 3) { // rectangle(x, y, w, h)
                  const rx = flat[fi], ry = flat[fi + 1], rw = flat[fi + 2], rh = flat[fi + 3];
                  fi += 4;
                  const [x1, y1] = transformPoint(rx, ry);
                  const [x2, y2] = transformPoint(rx + rw, ry + rh);
                  const rleft = Math.min(x1, x2);
                  const rbottom = Math.min(y1, y2);
                  const rwidth = Math.abs(x2 - x1);
                  const rheight = Math.abs(y2 - y1);
                  if (rwidth > 1 && rheight > 1) {
                    rects.push({
                      left: toPercentX(rleft),
                      top: toPercentY(rbottom + rheight),
                      width: (rwidth / pageWidth) * 100,
                      height: (rheight / pageHeight) * 100,
                    });
                  }
                  pathSegments.push({ x1: rleft, y1: rbottom, x2: rleft + rwidth, y2: rbottom });
                  pathSegments.push({ x1: rleft, y1: rbottom + rheight, x2: rleft + rwidth, y2: rbottom + rheight });
                  pathSegments.push({ x1: rleft, y1: rbottom, x2: rleft, y2: rbottom + rheight });
                  pathSegments.push({ x1: rleft + rwidth, y1: rbottom, x2: rleft + rwidth, y2: rbottom + rheight });
                } else if (opCode === 4) { // closePath
                  pathSegments.push({ x1: currentX, y1: currentY, x2: pathStartX, y2: pathStartY });
                  currentX = pathStartX; currentY = pathStartY;
                } else {
                  // Unknown op, skip
                  break;
                }
              }
            }
          }
          break;
        }

        let argIdx = 0;

        for (const op of ops) {
          if (op === OPS.moveTo) {
            const [tx, ty] = transformPoint(pathArgs[argIdx], pathArgs[argIdx + 1]);
            currentX = tx;
            currentY = ty;
            pathStartX = tx;
            pathStartY = ty;
            argIdx += 2;
          } else if (op === OPS.lineTo) {
            const [tx, ty] = transformPoint(pathArgs[argIdx], pathArgs[argIdx + 1]);
            pathSegments.push({ x1: currentX, y1: currentY, x2: tx, y2: ty });
            currentX = tx;
            currentY = ty;
            argIdx += 2;
          } else if (op === OPS.rectangle) {
            const rx = pathArgs[argIdx];
            const ry = pathArgs[argIdx + 1];
            const rw = pathArgs[argIdx + 2];
            const rh = pathArgs[argIdx + 3];
            argIdx += 4;

            // Transform corners
            const [x1, y1] = transformPoint(rx, ry);
            const [x2, y2] = transformPoint(rx + rw, ry + rh);

            const left = Math.min(x1, x2);
            const bottom = Math.min(y1, y2);
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);

            if (width > 1 && height > 1) { // Skip tiny rects
              rects.push({
                left: toPercentX(left),
                top: toPercentY(bottom + height),
                width: (width / pageWidth) * 100,
                height: (height / pageHeight) * 100,
              });
            }

            // Also add as line segments for the rectangle's borders
            pathSegments.push({ x1, y1, x2: x1 + width, y2: y1 }); // bottom
            pathSegments.push({ x1, y1: y1 + height, x2: x1 + width, y2: y1 + height }); // top
            pathSegments.push({ x1, y1, x2: x1, y2: y1 + height }); // left
            pathSegments.push({ x1: x1 + width, y1, x2: x1 + width, y2: y1 + height }); // right
          } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
            // Skip curves for now (they're not input field borders)
            argIdx += (op === OPS.curveTo) ? 6 : 4;
          } else if (op === OPS.closePath) {
            pathSegments.push({ x1: currentX, y1: currentY, x2: pathStartX, y2: pathStartY });
            currentX = pathStartX;
            currentY = pathStartY;
          }
        }
        break;
      }

      case OPS.stroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke: {
        // Commit path segments as visible lines
        for (const seg of pathSegments) {
          const dx = Math.abs(seg.x2 - seg.x1);
          const dy = Math.abs(seg.y2 - seg.y1);

          const isH = dy < 1 && dx > 5; // Horizontal: y doesn't change much, x spans > 5pts
          const isV = dx < 1 && dy > 5; // Vertical

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
        break;
      }

      case OPS.endPath:
        // Some PDFs never explicitly stroke/fill - treat endPath as implicit commit too
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
        break;
    }
  }

  // Commit any remaining path segments (for PDFs without explicit stroke/fill/endPath)
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

  await doc.destroy();

  return { lines, rects, texts, pageWidth, pageHeight };
}

// ─── Snapping ───────────────────────────────────────────────────────────────

function snapFieldsToVectorGeometry(
  fields: BenchmarkField[],
  geometry: PageGeometry,
  maxSnapDist: number = 3.0
): { fields: BenchmarkField[]; snappedCount: number } {
  // Filter to just horizontal lines with meaningful length
  const hLines = geometry.lines
    .filter((l) => l.isHorizontal && Math.abs(l.x2 - l.x1) > 5);

  let snappedCount = 0;

  const snappedFields = fields.map((field) => {
    if (!["text", "date"].includes(field.fieldType)) return field;

    const fieldBottom = field.coordinates.top + field.coordinates.height;
    const fieldLeft = field.coordinates.left;
    const fieldRight = fieldLeft + field.coordinates.width;

    let bestLine: VectorLine | null = null;
    let minDist = maxSnapDist;

    for (const line of hLines) {
      // Check horizontal overlap (at least 50%)
      const overlapLeft = Math.max(fieldLeft, line.x1);
      const overlapRight = Math.min(fieldRight, line.x2);
      if (overlapRight - overlapLeft < field.coordinates.width * 0.5) continue;

      // Use y1 (both y1 and y2 are similar for horizontal lines)
      const dist = Math.abs(line.y1 - fieldBottom);
      if (dist < minDist) {
        minDist = dist;
        bestLine = line;
      }
    }

    if (bestLine) {
      snappedCount++;
      const newTop = bestLine.y1 - field.coordinates.height;

      // Also snap left/width if line matches closely
      let newLeft = field.coordinates.left;
      let newWidth = field.coordinates.width;
      const lineWidth = Math.abs(bestLine.x2 - bestLine.x1);
      if (Math.abs(lineWidth - field.coordinates.width) < 8) {
        newLeft = bestLine.x1;
        newWidth = lineWidth;
      }

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

    return field;
  });

  return { fields: snappedFields, snappedCount };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[AutoForm] Script 2: PDF.js Vector Geometry Extraction\n");

  const pdfBuffer = loadTestPdf();
  const baseline = loadGeminiBaseline();
  const benchmark = loadBenchmark();

  // Extract geometry
  console.log("Extracting vector geometry from PDF...");
  const geometry = await extractPageGeometry(pdfBuffer, 1);

  console.log(`\nExtracted geometry:`);
  console.log(`  Lines: ${geometry.lines.length} (H: ${geometry.lines.filter(l => l.isHorizontal).length}, V: ${geometry.lines.filter(l => l.isVertical).length})`);
  console.log(`  Rects: ${geometry.rects.length}`);
  console.log(`  Texts: ${geometry.texts.length}`);

  // Print horizontal lines
  const hLines = geometry.lines.filter((l) => l.isHorizontal && Math.abs(l.x2 - l.x1) > 5);
  console.log(`\n── Horizontal lines (length > 5%) ──`);
  for (const line of hLines.sort((a, b) => a.y1 - b.y1)) {
    const length = Math.abs(line.x2 - line.x1);
    console.log(`  y=${line.y1.toFixed(1)}%  x=${line.x1.toFixed(1)}-${line.x2.toFixed(1)}%  len=${length.toFixed(1)}%`);
  }

  // Print significant rects
  const bigRects = geometry.rects.filter((r) => r.width > 3 && r.height > 1);
  console.log(`\n── Significant rectangles (w>3%, h>1%) ──`);
  for (const rect of bigRects.sort((a, b) => a.top - b.top)) {
    console.log(`  left=${rect.left.toFixed(1)}% top=${rect.top.toFixed(1)}% w=${rect.width.toFixed(1)}% h=${rect.height.toFixed(1)}%`);
  }

  // Save geometry
  saveResults("vectors", "prep_questionnaire_geometry.json", [] as any);
  const { writeFileSync, mkdirSync, existsSync } = await import("fs");
  const { resolve } = await import("path");
  const geoPath = resolve(PATHS.resultsDir, "vectors/prep_questionnaire_geometry_full.json");
  writeFileSync(geoPath, JSON.stringify(geometry, null, 2));
  console.log(`Full geometry saved to: ${geoPath}`);

  // Score baseline
  const baselineScore = scoreFields(baseline.fields, benchmark.fields);
  printScore("Gemini Baseline", baselineScore);

  // Snap fields to vector geometry
  const snapResult = snapFieldsToVectorGeometry(baseline.fields, geometry);
  console.log(`\nSnapped ${snapResult.snappedCount}/${baseline.fields.length} fields to vector lines`);

  saveResults("vectors", "prep_questionnaire_snapped.json", snapResult.fields);

  const snappedScore = scoreFields(snapResult.fields, benchmark.fields);
  printScore("After Vector Geometry Snapping", snappedScore);
  printScoreComparison(baselineScore, snappedScore);
  printFieldComparison("Vector Snap", baselineScore.matches, snappedScore.matches);
}

main().catch(console.error);
