// Image compositor for overlaying field boxes onto page images
// Used to prepare images for Gemini Vision

import sharp from "sharp";
import type { ExtractedField } from "./types";

interface CompositeOptions {
  imageBase64: string;
  fields: ExtractedField[];
  showGrid?: boolean;
  gridSpacing?: number; // percentage
}

interface CompositeResult {
  imageBase64: string;
  width: number;
  height: number;
}

/**
 * Creates an SVG overlay with field boxes and optional grid
 */
function createOverlaySvg(
  width: number,
  height: number,
  fields: ExtractedField[],
  showGrid: boolean,
  gridSpacing: number
): string {
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Draw grid if requested
  if (showGrid) {
    // Minor grid lines (every gridSpacing %)
    svg += `<g stroke="#999999" stroke-width="0.5" opacity="0.4">`;
    for (let x = 0; x <= 100; x += gridSpacing) {
      if (x % 25 !== 0) {
        const px = (x / 100) * width;
        svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
      }
    }
    for (let y = 0; y <= 100; y += gridSpacing) {
      if (y % 25 !== 0) {
        const py = (y / 100) * height;
        svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
      }
    }
    svg += `</g>`;

    // Major grid lines (every 25%)
    svg += `<g stroke="#666666" stroke-width="1" opacity="0.6">`;
    for (let x = 0; x <= 100; x += 25) {
      const px = (x / 100) * width;
      svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
    }
    for (let y = 0; y <= 100; y += 25) {
      const py = (y / 100) * height;
      svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
    }
    svg += `</g>`;

    // Percentage labels on edges
    svg += `<g font-family="Arial, sans-serif" fill="#000000">`;

    // Left edge (Y axis) - every 10%
    for (let y = 0; y <= 100; y += 10) {
      const py = (y / 100) * height;
      const isMajor = y % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      svg += `<rect x="0" y="${py}" width="24" height="14" fill="white" opacity="0.8"/>`;
      svg += `<text x="2" y="${py + 11}" font-size="${fontSize}" font-weight="${fontWeight}">${y}</text>`;
    }

    // Top edge (X axis) - every 10%
    for (let x = 10; x <= 100; x += 10) {
      const px = (x / 100) * width;
      const isMajor = x % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      svg += `<rect x="${px - 12}" y="0" width="24" height="14" fill="white" opacity="0.8"/>`;
      svg += `<text x="${px - 10}" y="11" font-size="${fontSize}" font-weight="${fontWeight}">${x}</text>`;
    }
    svg += `</g>`;
  }

  // Draw field boxes
  for (const field of fields) {
    const coords = field.coordinates;
    const x = (coords.left / 100) * width;
    const y = (coords.top / 100) * height;
    const w = (coords.width / 100) * width;
    const h = (coords.height / 100) * height;

    const color = getFieldColor(field.field_type);
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}20" stroke="${color}" stroke-width="2" />`;

    // Field label above the box
    const labelY = Math.max(y - 5, 12);
    svg += `<text x="${x}" y="${labelY}" font-size="10" font-family="Arial, sans-serif" fill="${color}" font-weight="bold">${escapeXml(field.label)}</text>`;

    // Field ID inside the box
    svg += `<text x="${x + 2}" y="${y + 12}" font-size="8" font-family="monospace" fill="#666666">${field.id.slice(0, 8)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Get color for field type
 */
function getFieldColor(fieldType: string): string {
  switch (fieldType) {
    case "text":
      return "#3b82f6"; // blue
    case "textarea":
      return "#8b5cf6"; // purple
    case "date":
      return "#f59e0b"; // amber
    case "checkbox":
      return "#10b981"; // green
    case "radio":
      return "#06b6d4"; // cyan
    case "signature":
      return "#ef4444"; // red
    case "initials":
      return "#ec4899"; // pink
    case "circle_choice":
      return "#f97316"; // orange
    default:
      return "#6b7280"; // gray
  }
}

/**
 * Escape special characters for XML/SVG
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Composite field boxes onto a page image
 * Returns a new base64 image with the overlays
 */
export async function compositeFieldsOntoImage(
  options: CompositeOptions
): Promise<CompositeResult> {
  const { imageBase64, fields, showGrid = true, gridSpacing = 10 } = options;

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  console.log("[AutoForm] Compositing image:", {
    width,
    height,
    fieldCount: fields.length,
    showGrid,
  });

  const overlaySvg = createOverlaySvg(width, height, fields, showGrid, gridSpacing);
  const overlayBuffer = Buffer.from(overlaySvg);

  const composited = await sharp(imageBuffer)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    imageBase64: composited.toString("base64"),
    width,
    height,
  };
}

/**
 * Resize image for Gemini Vision to reduce payload size and improve latency
 *
 * - Max 1600px width reduces upload time on mobile networks
 * - Smaller images = less noise for Gemini to process
 * - Maintains aspect ratio
 * - Uses high quality (0.85) to preserve lines and text edges for OCR
 *
 * @param imageBase64 - Base64 encoded image (without data URI prefix)
 * @param maxWidth - Maximum width in pixels (default 1600)
 * @returns Resized image as base64
 */
export async function resizeForGemini(
  imageBase64: string,
  maxWidth: number = 1600
): Promise<{ imageBase64: string; width: number; height: number }> {
  const inputBuffer = Buffer.from(imageBase64, "base64");

  const metadata = await sharp(inputBuffer).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;

  // If image is already small enough, return as-is
  if (originalWidth <= maxWidth) {
    return {
      imageBase64,
      width: originalWidth,
      height: originalHeight,
    };
  }

  const ratio = maxWidth / originalWidth;
  const newHeight = Math.round(originalHeight * ratio);

  console.log("[AutoForm] Resizing image for Gemini:", {
    originalWidth,
    originalHeight,
    newWidth: maxWidth,
    newHeight,
  });

  const resizedBuffer = await sharp(inputBuffer)
    .resize(maxWidth, newHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    imageBase64: resizedBuffer.toString("base64"),
    width: maxWidth,
    height: newHeight,
  };
}
