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
 *
 * @param pageBounds - If provided, grid labels show actual page coordinates (for cluster crops)
 */
function createOverlaySvg(
  width: number,
  height: number,
  fields: ExtractedField[],
  showGrid: boolean,
  gridSpacing: number,
  pageBounds?: { top: number; left: number; bottom: number; right: number }
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

    // Percentage labels on edges - every 10% for precision
    // Major labels (every 10%) - these help Gemini measure exact positions
    svg += `<g font-family="Arial, sans-serif" fill="#000000">`;

    // Left edge ruler (Y axis - top percentage) - every 10%
    for (let y = 0; y <= 100; y += 10) {
      const py = (y / 100) * height;
      const isMajor = y % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      // White background for readability
      svg += `<rect x="0" y="${py}" width="24" height="14" fill="white" opacity="0.8"/>`;
      svg += `<text x="2" y="${py + 11}" font-size="${fontSize}" font-weight="${fontWeight}">${y}</text>`;
    }

    // Top edge ruler (X axis - left percentage) - every 10%
    for (let x = 10; x <= 100; x += 10) {
      const px = (x / 100) * width;
      const isMajor = x % 20 === 0;
      const fontSize = isMajor ? 11 : 9;
      const fontWeight = isMajor ? "bold" : "normal";
      // White background for readability
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

/**
 * Quadrant bounds as percentages (0-100)
 */
export interface QuadrantBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Quadrant number (1-4) representing vertical quarters of the page
 */
export type QuadrantNumber = 1 | 2 | 3 | 4;

/**
 * Options for compositing a quadrant overlay onto a full page
 */
export interface QuadrantOverlayOptions {
  imageBase64: string;
  quadrant: QuadrantNumber;
  gridSpacing?: number; // Default 5% for dense grid
  overlayColor?: string; // Default purple
  overlayOpacity?: number; // Default 0.25 (25%)
}

/**
 * Get the bounds for a quadrant number (vertical quarters)
 * Q1: 0-25%, Q2: 25-50%, Q3: 50-75%, Q4: 75-100%
 */
export function getQuadrantBounds(quadrant: QuadrantNumber): QuadrantBounds {
  const quarters: Record<QuadrantNumber, QuadrantBounds> = {
    1: { top: 0, left: 0, bottom: 25, right: 100 },
    2: { top: 25, left: 0, bottom: 50, right: 100 },
    3: { top: 50, left: 0, bottom: 75, right: 100 },
    4: { top: 75, left: 0, bottom: 100, right: 100 },
  };
  return quarters[quadrant];
}

/**
 * Creates an SVG overlay with dense grid and highlighted quadrant region
 * Used for quadrant-based field extraction where Gemini sees the full page
 * but focuses on the highlighted purple region
 */
function createQuadrantOverlaySvg(
  width: number,
  height: number,
  quadrant: QuadrantNumber,
  gridSpacing: number,
  overlayColor: string,
  overlayOpacity: number
): string {
  const bounds = getQuadrantBounds(quadrant);

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Draw the purple quadrant highlight FIRST (so grid appears on top)
  const qx = (bounds.left / 100) * width;
  const qy = (bounds.top / 100) * height;
  const qw = ((bounds.right - bounds.left) / 100) * width;
  const qh = ((bounds.bottom - bounds.top) / 100) * height;
  svg += `<rect x="${qx}" y="${qy}" width="${qw}" height="${qh}" fill="${overlayColor}" opacity="${overlayOpacity}" />`;

  // Draw quadrant boundary with a more visible stroke
  svg += `<rect x="${qx}" y="${qy}" width="${qw}" height="${qh}" fill="none" stroke="${overlayColor}" stroke-width="3" opacity="0.8" />`;

  // Draw dense grid lines across ENTIRE page (not just quadrant)
  // Grid color: blue for visibility against purple overlay and page content
  const gridColor = "#3b82f6";

  // Minor grid lines (every gridSpacing %)
  svg += `<g stroke="${gridColor}" stroke-width="0.5" opacity="0.5">`;
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

  // Major grid lines (every 25%) - these mark quadrant boundaries
  svg += `<g stroke="${gridColor}" stroke-width="1.5" opacity="0.7">`;
  for (let x = 0; x <= 100; x += 25) {
    const px = (x / 100) * width;
    svg += `<line x1="${px}" y1="0" x2="${px}" y2="${height}" />`;
  }
  for (let y = 0; y <= 100; y += 25) {
    const py = (y / 100) * height;
    svg += `<line x1="0" y1="${py}" x2="${width}" y2="${py}" />`;
  }
  svg += `</g>`;

  // Percentage labels on edges - every gridSpacing% for precision
  svg += `<g font-family="Arial, sans-serif" fill="#000000">`;

  // Left edge ruler (Y axis) - every gridSpacing%
  for (let y = 0; y <= 100; y += gridSpacing) {
    const py = (y / 100) * height;
    const isMajor = y % 25 === 0;
    const fontSize = isMajor ? 16 : 12;
    const fontWeight = isMajor ? "bold" : "normal";
    // White background for readability
    svg += `<rect x="0" y="${py - 2}" width="30" height="18" fill="white" opacity="0.9"/>`;
    svg += `<text x="2" y="${py + 12}" font-size="${fontSize}" font-weight="${fontWeight}">${y}</text>`;
  }

  // Top edge ruler (X axis) - every 10% to keep it readable
  for (let x = 10; x <= 100; x += 10) {
    const px = (x / 100) * width;
    const isMajor = x % 25 === 0;
    const fontSize = isMajor ? 16 : 12;
    const fontWeight = isMajor ? "bold" : "normal";
    // White background for readability
    svg += `<rect x="${px - 16}" y="0" width="32" height="18" fill="white" opacity="0.9"/>`;
    svg += `<text x="${px - 14}" y="14" font-size="${fontSize}" font-weight="${fontWeight}">${x}</text>`;
  }
  svg += `</g>`;

  svg += `</svg>`;
  return svg;
}

/**
 * Composite a quadrant overlay onto a full page image
 * Returns the FULL PAGE with a dense grid and highlighted quadrant region
 * Used for quadrant-based field extraction where each agent sees the full page
 * but focuses on their assigned quadrant
 */
export async function compositeQuadrantOverlay(
  options: QuadrantOverlayOptions
): Promise<CompositeResult> {
  const {
    imageBase64,
    quadrant,
    gridSpacing = 5, // Dense grid by default
    overlayColor = "#8B5CF6", // Purple (violet-500)
    overlayOpacity = 0.25,
  } = options;

  // Decode base64 image
  const imageBuffer = Buffer.from(imageBase64, "base64");

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1000;

  console.log("[AutoForm] Compositing quadrant overlay:", {
    quadrant,
    width,
    height,
    gridSpacing: `${gridSpacing}%`,
    overlayColor,
    overlayOpacity,
  });

  // Create SVG overlay with grid and quadrant highlight
  const overlaySvg = createQuadrantOverlaySvg(
    width,
    height,
    quadrant,
    gridSpacing,
    overlayColor,
    overlayOpacity
  );
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

  return {
    imageBase64: composited.toString("base64"),
    width,
    height,
  };
}

/**
 * Crop an image to a quadrant and composite fields onto it
 * Returns the cropped image with field overlays, plus coordinate adjustment info
 */
export async function cropAndCompositeQuadrant(options: {
  imageBase64: string;
  fields: ExtractedField[];
  bounds: QuadrantBounds;
  showGrid?: boolean;
  gridSpacing?: number;
}): Promise<CompositeResult & { bounds: QuadrantBounds }> {
  const { imageBase64, fields, bounds, showGrid = true, gridSpacing: providedGridSpacing } = options;

  // DYNAMIC GRID SPACING: Smaller crops get finer grids for precision
  // Calculate crop area as percentage of full page
  const cropWidthPct = bounds.right - bounds.left;
  const cropHeightPct = bounds.bottom - bounds.top;
  const cropAreaPct = (cropWidthPct * cropHeightPct) / 100; // 0-100 scale

  // Determine optimal grid spacing:
  // - cropArea < 15%: very tight crop → 5% grid (2x precision)
  // - cropArea < 30%: medium crop → 7% grid (~1.4x precision)
  // - cropArea >= 30%: large crop → 10% grid (standard)
  const dynamicGridSpacing = cropAreaPct < 15 ? 5 : cropAreaPct < 30 ? 7 : 10;
  const gridSpacing = providedGridSpacing ?? dynamicGridSpacing;

  // Decode base64 image
  const imageBuffer = Buffer.from(imageBase64, "base64");

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const fullWidth = metadata.width || 800;
  const fullHeight = metadata.height || 1000;

  // Calculate crop region in pixels
  const cropLeft = Math.round((bounds.left / 100) * fullWidth);
  const cropTop = Math.round((bounds.top / 100) * fullHeight);
  const cropWidth = Math.round(((bounds.right - bounds.left) / 100) * fullWidth);
  const cropHeight = Math.round(((bounds.bottom - bounds.top) / 100) * fullHeight);

  console.log("[AutoForm] Cropping quadrant:", {
    bounds,
    pixels: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
    cropAreaPct: cropAreaPct.toFixed(1) + "%",
    gridSpacing: `${gridSpacing}% (${providedGridSpacing ? "provided" : "dynamic"})`,
  });

  // Crop the image
  const croppedBuffer = await sharp(imageBuffer)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    })
    .toBuffer();

  // Adjust field coordinates relative to quadrant
  const quadrantFields = fields.map((field) => ({
    ...field,
    coordinates: {
      // Remap coordinates from page-relative to quadrant-relative
      left: ((field.coordinates.left - bounds.left) / (bounds.right - bounds.left)) * 100,
      top: ((field.coordinates.top - bounds.top) / (bounds.bottom - bounds.top)) * 100,
      width: (field.coordinates.width / (bounds.right - bounds.left)) * 100,
      height: (field.coordinates.height / (bounds.bottom - bounds.top)) * 100,
    },
  }));

  // Create SVG overlay for the cropped image
  // Pass bounds so grid shows region header for cluster context
  const overlaySvg = createOverlaySvg(
    cropWidth,
    cropHeight,
    quadrantFields,
    showGrid,
    gridSpacing,
    bounds
  );
  const overlayBuffer = Buffer.from(overlaySvg);

  // Composite the overlay onto the cropped image
  const composited = await sharp(croppedBuffer)
    .composite([
      {
        input: overlayBuffer,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return {
    imageBase64: composited.toString("base64"),
    width: cropWidth,
    height: cropHeight,
    bounds,
  };
}

/**
 * Resize image for Gemini Vision to reduce payload size and improve latency
 *
 * Based on partner prototype learnings:
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

  // Get original dimensions
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

  // Calculate new dimensions maintaining aspect ratio
  const ratio = maxWidth / originalWidth;
  const newHeight = Math.round(originalHeight * ratio);

  console.log("[AutoForm] Resizing image for Gemini:", {
    originalWidth,
    originalHeight,
    newWidth: maxWidth,
    newHeight,
  });

  // Resize with high quality settings for OCR accuracy
  const resizedBuffer = await sharp(inputBuffer)
    .resize(maxWidth, newHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 }) // High quality to preserve text edges
    .toBuffer();

  return {
    imageBase64: resizedBuffer.toString("base64"),
    width: maxWidth,
    height: newHeight,
  };
}
