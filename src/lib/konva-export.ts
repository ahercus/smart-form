/**
 * Konva-based WYSIWYG export utility
 *
 * Renders fields to a Konva stage exactly as they appear on screen,
 * then exports to PNG. This ensures what you see = what you export.
 *
 * Each render function here mirrors its on-screen counterpart:
 * - renderCheckboxX       ↔ CheckboxFieldShape
 * - renderTextValue       ↔ TextFieldShape
 * - renderSignatureImage  ↔ SignatureFieldShape
 * - renderCircleChoices   ↔ ChoiceFieldShape
 * - renderLinkedDate      ↔ LinkedDateFieldShape
 */

import Konva from "konva";
import type { ExtractedField, DatePart } from "@/lib/types";

export interface PageOverlayCapture {
  pageNumber: number;
  imageDataUrl: string;
  width: number;
  height: number;
}

/**
 * Calculate consistent page font size (matches KonvaFieldCanvas logic)
 *
 * Uses 75% of the smallest text field height on the page, clamped 10-24px.
 * This ensures all text fields on a page share the same font size.
 */
function calculatePageFontSize(
  fields: ExtractedField[],
  pageHeight: number
): number | null {
  const textFields = fields.filter((f) =>
    ["text", "textarea", "date"].includes(f.field_type)
  );
  if (textFields.length === 0) return null;

  const minHeightPx = Math.min(
    ...textFields.map((f) => (f.coordinates.height / 100) * pageHeight)
  );
  return Math.min(Math.max(minHeightPx * 0.75, 10), 24);
}

/**
 * Check if a value represents a checked checkbox
 */
function isCheckboxChecked(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "checked" ||
    normalized === "on" ||
    normalized === "1" ||
    normalized === "x"
  );
}

/**
 * Parse a date value into day, month, year parts
 * Accepts ISO (YYYY-MM-DD), AU/UK (DD/MM/YYYY), or US (MM/DD/YYYY) formats
 */
function parseDateValue(
  value: string
): Record<DatePart, string> | null {
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return { day, month, year, year2: year.slice(-2) };
  }

  const dmyMatch = value.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return {
      day: day.padStart(2, "0"),
      month: month.padStart(2, "0"),
      year,
      year2: year.slice(-2),
    };
  }

  const parts = value.split(/[/\-]/);
  if (parts.length === 3) {
    const [first, second, third] = parts;
    if (third.length === 4) {
      return {
        day: first.padStart(2, "0"),
        month: second.padStart(2, "0"),
        year: third,
        year2: third.slice(-2),
      };
    }
  }

  return null;
}

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

  // Calculate consistent font size for this page (matches KonvaFieldCanvas)
  const pageFontSize = calculatePageFontSize(pageFields, pageHeight);

  // Create off-screen container
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  try {
    const stage = new Konva.Stage({
      container,
      width: pageWidth,
      height: pageHeight,
    });

    const layer = new Konva.Layer();
    stage.add(layer);

    // Render each field with a value
    for (const field of pageFields) {
      const value = fieldValues[field.id] || "";
      if (!value) continue;

      await renderFieldToLayer(
        layer,
        field,
        value,
        pageWidth,
        pageHeight,
        pageFontSize
      );
    }

    layer.draw();

    const dataUrl = stage.toDataURL({ pixelRatio });
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
 * Render a field to a Konva layer (matches FieldShape routing)
 */
async function renderFieldToLayer(
  layer: Konva.Layer,
  field: ExtractedField,
  value: string,
  pageWidth: number,
  pageHeight: number,
  pageFontSize: number | null
): Promise<void> {
  const coords = field.coordinates;
  const x = (coords.left / 100) * pageWidth;
  const y = (coords.top / 100) * pageHeight;
  const width = (coords.width / 100) * pageWidth;
  const height = (coords.height / 100) * pageHeight;

  switch (field.field_type) {
    case "checkbox":
      if (isCheckboxChecked(value)) {
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

    case "date":
      // Segmented date fields render each box separately
      if (field.date_segments && field.date_segments.length > 0) {
        renderLinkedDate(layer, field, value, pageWidth, pageHeight, pageFontSize);
      } else {
        renderTextValue(layer, value, x, y, width, height, pageFontSize, false);
      }
      break;

    case "textarea":
      renderTextValue(layer, value, x, y, width, height, pageFontSize, true);
      break;

    default:
      // text, unknown, and other types
      renderTextValue(layer, value, x, y, width, height, pageFontSize, false);
      break;
  }
}

/**
 * Render checkbox X mark (matches CheckboxFieldShape)
 */
function renderCheckboxX(
  layer: Konva.Layer,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const padding = Math.min(width, height) * 0.15;

  // First diagonal (top-left to bottom-right)
  layer.add(
    new Konva.Line({
      points: [
        x + padding,
        y + padding,
        x + width - padding,
        y + height - padding,
      ],
      stroke: "#000000",
      strokeWidth: 2,
      lineCap: "round",
    })
  );

  // Second diagonal (bottom-left to top-right)
  layer.add(
    new Konva.Line({
      points: [
        x + padding,
        y + height - padding,
        x + width - padding,
        y + padding,
      ],
      stroke: "#000000",
      strokeWidth: 2,
      lineCap: "round",
    })
  );
}

/**
 * Render signature/initials image (matches SignatureFieldShape)
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
 * Render circle choice selections (matches ChoiceFieldShape)
 */
function renderCircleChoices(
  layer: Konva.Layer,
  field: ExtractedField,
  value: string,
  pageWidth: number,
  pageHeight: number
): void {
  const selectedLabels = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const padding = 4;

  for (const label of selectedLabels) {
    const option = field.choice_options?.find((opt) => opt.label === label);
    if (!option) continue;

    const ox = (option.coordinates.left / 100) * pageWidth;
    const oy = (option.coordinates.top / 100) * pageHeight;
    const ow = (option.coordinates.width / 100) * pageWidth;
    const oh = (option.coordinates.height / 100) * pageHeight;

    const centerX = ox + ow / 2;
    const centerY = oy + oh / 2;
    const radiusX = ow / 2 + padding;
    const radiusY = oh / 2 + padding;

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
 * Render linked date segments (matches LinkedDateFieldShape)
 *
 * Each date segment (day, month, year) is rendered in its own box
 * at the segment's specific coordinates.
 */
function renderLinkedDate(
  layer: Konva.Layer,
  field: ExtractedField,
  value: string,
  pageWidth: number,
  pageHeight: number,
  pageFontSize: number | null
): void {
  const dateSegments = field.date_segments;
  if (!dateSegments || dateSegments.length === 0) return;

  const dateParts = parseDateValue(value);
  if (!dateParts) return;

  for (const segment of dateSegments) {
    const sx = (segment.left / 100) * pageWidth;
    const sy = (segment.top / 100) * pageHeight;
    const sw = (segment.width / 100) * pageWidth;
    const sh = (segment.height / 100) * pageHeight;

    const segmentValue = dateParts[segment.part];
    if (!segmentValue) continue;

    const fontSize =
      pageFontSize ?? Math.min(Math.max(sh * 0.75, 10), 24);
    const padding = 2;

    layer.add(
      new Konva.Text({
        x: sx + padding,
        y: sy + (sh - fontSize) / 2,
        width: sw - padding * 2,
        text: segmentValue,
        fontSize,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fill: "#374151",
        align: "center",
      })
    );
  }
}

/**
 * Render text value (matches TextFieldShape)
 *
 * Uses Konva's built-in text layout for proper word wrapping,
 * ellipsis, and vertical alignment - matching the on-screen display.
 */
function renderTextValue(
  layer: Konva.Layer,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  pageFontSize: number | null,
  isTextarea: boolean
): void {
  const fontSize =
    pageFontSize ?? Math.min(Math.max(height * 0.75, 10), 24);
  const padding = 4;

  layer.add(
    new Konva.Text({
      x: x + padding,
      y: isTextarea ? y + padding : y + (height - fontSize) / 2,
      width: width - padding * 2,
      height: isTextarea ? height - padding * 2 : undefined,
      text: value,
      fontSize,
      fontFamily: "system-ui, -apple-system, sans-serif",
      fill: "#374151",
      ellipsis: !isTextarea,
      wrap: isTextarea ? "word" : "none",
      verticalAlign: isTextarea ? "top" : "middle",
    })
  );
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
