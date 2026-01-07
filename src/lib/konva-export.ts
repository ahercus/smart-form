/**
 * Konva-based WYSIWYG export utility
 *
 * Renders fields to a Konva stage exactly as they appear on screen,
 * then exports to PNG. This ensures what you see = what you export.
 */

import Konva from "konva";
import type { ExtractedField } from "@/lib/types";

export interface PageOverlayCapture {
  pageNumber: number;
  imageDataUrl: string;
  width: number;
  height: number;
}

// Field type colors (matching the React components)
const FIELD_COLORS: Record<string, string> = {
  text: "#3b82f6",
  textarea: "#8b5cf6",
  date: "#f59e0b",
  checkbox: "#10b981",
  signature: "#ef4444",
  initials: "#ec4899",
  circle_choice: "#f97316",
  default: "#6b7280",
};

/**
 * Render a single page's fields to a Konva stage and export as PNG
 */
async function renderPageToKonva(
  fields: ExtractedField[],
  fieldValues: Record<string, string>,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  pixelRatio: number = 4
): Promise<PageOverlayCapture | null> {
  const pageFields = fields.filter((f) => f.page_number === pageNumber);

  if (pageFields.length === 0) {
    return null;
  }

  // Create off-screen container
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  try {
    // Create Konva stage
    const stage = new Konva.Stage({
      container,
      width: pageWidth,
      height: pageHeight,
    });

    const layer = new Konva.Layer();
    stage.add(layer);

    // Render each field
    for (const field of pageFields) {
      const value = fieldValues[field.id] || "";
      if (!value) continue;

      await renderFieldToLayer(layer, field, value, pageWidth, pageHeight);
    }

    layer.draw();

    // Export to data URL
    const dataUrl = stage.toDataURL({ pixelRatio });

    // Cleanup
    stage.destroy();

    return {
      pageNumber,
      imageDataUrl: dataUrl,
      width: pageWidth,
      height: pageHeight,
    };
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Render a field to a Konva layer
 */
async function renderFieldToLayer(
  layer: Konva.Layer,
  field: ExtractedField,
  value: string,
  pageWidth: number,
  pageHeight: number
): Promise<void> {
  const coords = field.coordinates;
  const x = (coords.left / 100) * pageWidth;
  const y = (coords.top / 100) * pageHeight;
  const width = (coords.width / 100) * pageWidth;
  const height = (coords.height / 100) * pageHeight;

  switch (field.field_type) {
    case "checkbox":
      if (value === "yes" || value === "true") {
        renderCheckboxX(layer, x, y, width, height);
      }
      break;

    case "signature":
    case "initials":
      if (value.startsWith("data:image")) {
        await renderSignatureImage(layer, value, x, y, width, height);
      }
      break;

    case "circle_choice":
      if (field.choice_options) {
        renderCircleChoices(layer, field, value, pageWidth, pageHeight);
      }
      break;

    default:
      // Text fields
      renderTextValue(layer, value, x, y, width, height);
      break;
  }
}

/**
 * Render checkbox X mark
 */
function renderCheckboxX(
  layer: Konva.Layer,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const padding = Math.min(width, height) * 0.15;

  // First diagonal
  layer.add(
    new Konva.Line({
      points: [x + padding, y + padding, x + width - padding, y + height - padding],
      stroke: "#000000",
      strokeWidth: 2,
      lineCap: "round",
    })
  );

  // Second diagonal
  layer.add(
    new Konva.Line({
      points: [x + padding, y + height - padding, x + width - padding, y + padding],
      stroke: "#000000",
      strokeWidth: 2,
      lineCap: "round",
    })
  );
}

/**
 * Render signature/initials image
 */
async function renderSignatureImage(
  layer: Konva.Layer,
  dataUrl: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Calculate dimensions maintaining aspect ratio
      const imgAspect = img.width / img.height;
      const fieldAspect = width / height;
      const padding = 4;

      let drawWidth = width - padding * 2;
      let drawHeight = height - padding * 2;

      if (imgAspect > fieldAspect) {
        drawHeight = drawWidth / imgAspect;
      } else {
        drawWidth = drawHeight * imgAspect;
      }

      const offsetX = (width - drawWidth) / 2;
      const offsetY = (height - drawHeight) / 2;

      layer.add(
        new Konva.Image({
          image: img,
          x: x + offsetX,
          y: y + offsetY,
          width: drawWidth,
          height: drawHeight,
        })
      );

      resolve();
    };

    img.onerror = () => {
      console.error("[AutoForm] Failed to load signature for export");
      resolve();
    };

    img.src = dataUrl;
  });
}

/**
 * Render circle choice selections
 */
function renderCircleChoices(
  layer: Konva.Layer,
  field: ExtractedField,
  value: string,
  pageWidth: number,
  pageHeight: number
): void {
  const selectedLabels = value.split(",").map((s) => s.trim()).filter(Boolean);
  const padding = 4;

  for (const label of selectedLabels) {
    const option = field.choice_options?.find((opt) => opt.label === label);
    if (!option) continue;

    const x = (option.coordinates.left / 100) * pageWidth;
    const y = (option.coordinates.top / 100) * pageHeight;
    const w = (option.coordinates.width / 100) * pageWidth;
    const h = (option.coordinates.height / 100) * pageHeight;

    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const radiusX = w / 2 + padding;
    const radiusY = h / 2 + padding;

    layer.add(
      new Konva.Ellipse({
        x: centerX,
        y: centerY,
        radiusX,
        radiusY,
        stroke: "#000000",
        strokeWidth: 2,
        fill: "transparent",
      })
    );
  }
}

/**
 * Render text value
 */
function renderTextValue(
  layer: Konva.Layer,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const fontSize = Math.min(Math.max(height * 0.5, 8), 12);
  const padding = 4;

  // Handle multi-line text
  const lines = value.split("\n");
  const lineHeight = fontSize * 1.2;

  for (let i = 0; i < lines.length; i++) {
    const lineY = y + padding + i * lineHeight + (height - fontSize) / 2 - padding;
    // Stop if we've gone past the field bottom
    if (lineY + fontSize > y + height) break;

    layer.add(
      new Konva.Text({
        x: x + padding,
        y: y + (height - fontSize) / 2,
        width: width - padding * 2,
        text: lines[i],
        fontSize,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fill: "#374151",
      })
    );
  }
}

/**
 * Render overlays for all pages using Konva (WYSIWYG)
 */
export async function renderAllPageOverlaysKonva(
  fields: ExtractedField[],
  fieldValues: Record<string, string>,
  totalPages: number,
  pageWidth: number,
  pageHeight: number
): Promise<PageOverlayCapture[]> {
  const captures: PageOverlayCapture[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const capture = await renderPageToKonva(
      fields,
      fieldValues,
      pageNum,
      pageWidth,
      pageHeight
    );
    if (capture) {
      captures.push(capture);
    }
  }

  return captures;
}
