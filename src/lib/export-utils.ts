import type { ExtractedField } from "@/lib/types";

export interface PageOverlayCapture {
  pageNumber: number;
  imageDataUrl: string; // PNG as data URL
  width: number;
  height: number;
}

/**
 * Renders field overlays directly to canvas for a given page.
 * This creates a transparent PNG with just the field values rendered.
 */
export async function renderOverlayToCanvas(
  fields: ExtractedField[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
): Promise<PageOverlayCapture | null> {
  const pageFields = fields.filter((f) => f.page_number === pageNumber);

  if (pageFields.length === 0) {
    return null;
  }

  // Create canvas at 4x scale for print quality (~300 DPI)
  const scale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = pageWidth * scale;
  canvas.height = pageHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(scale, scale);

  // Log ALL field types and any fields with data:image values
  const fieldTypes = [...new Set(pageFields.map(f => f.field_type))];
  const imageFields = pageFields.filter(f => f.value?.startsWith("data:image"));
  console.log("[AutoForm] Rendering page", pageNumber, "with", pageFields.length, "fields");
  console.log("[AutoForm] Field types on page:", fieldTypes);
  if (imageFields.length > 0) {
    console.log("[AutoForm] Fields with image values:", imageFields.length);
    imageFields.forEach(f => console.log("[AutoForm] Image field:", f.id, f.field_type, "value starts with:", f.value?.substring(0, 50)));
  }

  for (const field of pageFields) {
    if (!field.value) continue;

    // Debug: log fields with values
    const valuePreview = field.value?.substring(0, 30);
    console.log("[AutoForm] Field:", field.id, field.field_type, valuePreview);

    const coords = field.coordinates;
    const x = (coords.left / 100) * pageWidth;
    const y = (coords.top / 100) * pageHeight;
    const fieldWidth = (coords.width / 100) * pageWidth;
    const fieldHeight = (coords.height / 100) * pageHeight;

    // Handle signature/initials (data URL images)
    if (
      (field.field_type === "signature" || field.field_type === "initials") &&
      field.value.startsWith("data:image")
    ) {
      console.log("[AutoForm] Processing signature field:", field.id, field.field_type, "value length:", field.value.length);
      await drawSignature(ctx, field.value, x, y, fieldWidth, fieldHeight);
      continue;
    }

    // Handle checkbox fields - draw X mark
    if (field.field_type === "checkbox") {
      if (field.value === "yes" || field.value === "true") {
        drawXMark(ctx, x, y, fieldWidth, fieldHeight);
      }
      continue;
    }

    // Handle circle_choice fields - draw circles around selected options
    if (field.field_type === "circle_choice" && field.choice_options) {
      const selectedLabels = field.value.split(",").map((s) => s.trim()).filter(Boolean);
      for (const label of selectedLabels) {
        const option = field.choice_options.find((opt) => opt.label === label);
        if (option) {
          const optX = (option.coordinates.left / 100) * pageWidth;
          const optY = (option.coordinates.top / 100) * pageHeight;
          const optWidth = (option.coordinates.width / 100) * pageWidth;
          const optHeight = (option.coordinates.height / 100) * pageHeight;
          drawEllipse(ctx, optX, optY, optWidth, optHeight);
        }
      }
      continue;
    }

    // Draw text value - use smaller font to match overlay appearance
    // PDF points are 72/inch, but overlay uses CSS pixels at screen DPI
    // Reduce font size to compensate for density difference
    const fontSize = Math.min(Math.max(fieldHeight * 0.5, 6), 9);
    const padding = 2;

    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#374151"; // text-gray-700
    ctx.textBaseline = "top";

    // Handle multi-line text
    const lines = field.value.split("\n");
    const lineHeight = fontSize * 1.2;

    for (let i = 0; i < lines.length; i++) {
      const lineY = y + padding + i * lineHeight;
      // Stop if we've gone past the field bottom
      if (lineY + fontSize > y + fieldHeight) break;
      ctx.fillText(lines[i], x + padding, lineY);
    }
  }

  return {
    pageNumber,
    imageDataUrl: canvas.toDataURL("image/png"),
    width: pageWidth,
    height: pageHeight,
  };
}

/**
 * Draw a signature image onto the canvas
 */
async function drawSignature(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // Maintain aspect ratio
        const imgAspect = img.width / img.height;
        const fieldAspect = width / height;

        let drawWidth = width;
        let drawHeight = height;

        if (imgAspect > fieldAspect) {
          drawHeight = width / imgAspect;
        } else {
          drawWidth = height * imgAspect;
        }

        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;

        ctx.drawImage(img, x + offsetX, y + offsetY, drawWidth, drawHeight);
        console.log("[AutoForm] Signature drawn:", { x, y, width: drawWidth, height: drawHeight });
      } catch (err) {
        console.error("[AutoForm] Error drawing signature:", err);
      }
      resolve();
    };

    img.onerror = (err) => {
      console.error("[AutoForm] Failed to load signature image:", err, dataUrl.substring(0, 50));
      resolve();
    };

    img.src = dataUrl;
  });
}

/**
 * Draw an X mark (for checkboxes)
 */
function drawXMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const padding = Math.min(width, height) * 0.15;
  const x1 = x + padding;
  const y1 = y + padding;
  const x2 = x + width - padding;
  const y2 = y + height - padding;

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1, y2);
  ctx.lineTo(x2, y1);
  ctx.stroke();
}

/**
 * Draw an ellipse (for circle_choice fields)
 */
function drawEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const padding = 4;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2 + padding;
  const radiusY = height / 2 + padding;

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
  ctx.stroke();
}

/**
 * Render overlays for all pages
 */
export async function renderAllPageOverlays(
  fields: ExtractedField[],
  totalPages: number,
  pageWidth: number,
  pageHeight: number
): Promise<PageOverlayCapture[]> {
  // Log all fields by page and type for debugging
  console.log("[AutoForm] renderAllPageOverlays:", totalPages, "pages,", fields.length, "total fields");
  for (let p = 1; p <= totalPages; p++) {
    const pf = fields.filter(f => f.page_number === p);
    const types = [...new Set(pf.map(f => f.field_type))];
    const withValues = pf.filter(f => f.value).length;
    const sigFields = pf.filter(f => f.field_type === "signature" || f.field_type === "initials");
    console.log(`[AutoForm] Page ${p}: ${pf.length} fields (${withValues} with values), types: ${types.join(", ")}, signatures: ${sigFields.length}`);
    if (sigFields.length > 0) {
      sigFields.forEach(f => console.log(`  - Sig field ${f.id}: type=${f.field_type}, hasValue=${!!f.value}`));
    }
  }

  const captures: PageOverlayCapture[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const capture = await renderOverlayToCanvas(fields, pageNum, pageWidth, pageHeight);
    if (capture) {
      captures.push(capture);
    }
  }

  return captures;
}
