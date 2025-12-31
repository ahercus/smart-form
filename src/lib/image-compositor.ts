// Image compositor for overlaying field boxes onto page images
// Used to prepare images for Gemini Vision QC

import sharp from "sharp";
import type { ExtractedField, NormalizedCoordinates } from "./types";

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
 * Grid includes percentage labels to help Gemini orient accurately
 */
function createOverlaySvg(
  width: number,
  height: number,
  fields: ExtractedField[],
  showGrid: boolean,
  gridSpacing: number
): string {
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Draw grid if requested - with labels and major/minor line distinction
  if (showGrid) {
    // Minor grid lines (every gridSpacing %) - light gray, thin
    svg += `<g stroke="#999999" stroke-width="0.5" opacity="0.4">`;
    for (let x = 0; x <= 100; x += gridSpacing) {
      if (x % 25 !== 0) { // Skip major lines
        const px = (x / 100) * width;
        svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
      }
    }
    for (let y = 0; y <= 100; y += gridSpacing) {
      if (y % 25 !== 0) { // Skip major lines
        const py = (y / 100) * height;
        svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
      }
    }
    svg += `</g>`;

    // Major grid lines (every 25%) - darker, thicker
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

    // Percentage labels on edges - helps Gemini know exact positions
    svg += `<g font-size="10" font-family="Arial, sans-serif" fill="#333333" font-weight="bold">`;
    // Left edge labels (Y axis - top percentage)
    for (let y = 0; y <= 100; y += 25) {
      const py = (y / 100) * height;
      svg += `<text x="2" y="${py + 10}">${y}%</text>`;
    }
    // Top edge labels (X axis - left percentage)
    for (let x = 25; x <= 100; x += 25) {
      const px = (x / 100) * width;
      svg += `<text x="${px - 15}" y="12">${x}%</text>`;
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

    // Field box with colored stroke based on type
    const color = getFieldColor(field.field_type);
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}20" stroke="${color}" stroke-width="2" />`;

    // Field label above the box
    const labelY = Math.max(y - 5, 12);
    svg += `<text x="${x}" y="${labelY}" font-size="10" font-family="Arial, sans-serif" fill="${color}" font-weight="bold">${escapeXml(field.label)}</text>`;

    // Field ID inside the box (for Gemini reference)
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

  // Decode base64 image
  const imageBuffer = Buffer.from(imageBase64, "base64");

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  console.log("[AutoForm] Compositing image:", {
    width,
    height,
    fieldCount: fields.length,
    showGrid,
  });

  // Create SVG overlay
  const overlaySvg = createOverlaySvg(width, height, fields, showGrid, gridSpacing);
  const overlayBuffer = Buffer.from(overlaySvg);

  // Composite the overlay onto the image
  const composited = await sharp(imageBuffer)
    .composite([
      {
        input: overlayBuffer,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const compositedBase64 = composited.toString("base64");

  return {
    imageBase64: compositedBase64,
    width,
    height,
  };
}

/**
 * Create a grid-only overlay (no fields) for fallback mode
 */
export async function createGridOverlay(
  imageBase64: string,
  gridSpacing: number = 10
): Promise<CompositeResult> {
  return compositeFieldsOntoImage({
    imageBase64,
    fields: [],
    showGrid: true,
    gridSpacing,
  });
}
