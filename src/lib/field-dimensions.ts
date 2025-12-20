// Field dimension calculations for character limits
// Ensures AI auto-fill values fit within field bounds without clipping

import type { NormalizedCoordinates, FieldType } from "./types";

// Default font sizes used in PDF forms (in points)
const DEFAULT_FONT_SIZE_PT = 10;
const LINE_HEIGHT_FACTOR = 1.2;

// Character width ratios (character width / font size)
// These are approximate averages for common fonts
const CHAR_WIDTH_RATIOS: Record<string, number> = {
  text: 0.5, // Proportional font (Arial, Helvetica)
  date: 0.55, // Slightly wider for numbers
  textarea: 0.5,
  default: 0.5,
};

interface PageDimensions {
  widthPx: number;
  heightPx: number;
  dpi?: number;
}

interface CharacterLimits {
  maxChars: number;
  charsPerLine: number;
  maxLines: number;
  recommendedLength: number; // 80% of max for safety margin
  fontSizePt: number;
}

/**
 * Calculate character limits for a field based on its dimensions
 *
 * @param coordinates - Field coordinates as percentages (0-100)
 * @param pageDimensions - Page dimensions in pixels
 * @param fieldType - Type of field (affects character width ratio)
 * @param fontSizePt - Font size in points (default: 10pt)
 */
export function calculateCharacterLimits(
  coordinates: NormalizedCoordinates,
  pageDimensions: PageDimensions,
  fieldType: FieldType,
  fontSizePt: number = DEFAULT_FONT_SIZE_PT
): CharacterLimits {
  const { widthPx, heightPx, dpi = 96 } = pageDimensions;

  // Convert percentage coordinates to pixels
  const fieldWidthPx = (coordinates.width / 100) * widthPx;
  const fieldHeightPx = (coordinates.height / 100) * heightPx;

  // Convert font size from points to pixels
  // 1 point = 1/72 inch, so at 96 DPI: 1pt = 96/72 = 1.333px
  const fontSizePx = fontSizePt * (dpi / 72);

  // Calculate character width based on field type
  const charWidthRatio = CHAR_WIDTH_RATIOS[fieldType] || CHAR_WIDTH_RATIOS.default;
  const charWidthPx = fontSizePx * charWidthRatio;

  // Calculate line height
  const lineHeightPx = fontSizePx * LINE_HEIGHT_FACTOR;

  // Calculate characters per line (with small padding for margins)
  const usableWidth = fieldWidthPx * 0.95; // 5% padding
  const charsPerLine = Math.floor(usableWidth / charWidthPx);

  // Calculate max lines
  const usableHeight = fieldHeightPx * 0.9; // 10% padding
  const maxLines = Math.max(1, Math.floor(usableHeight / lineHeightPx));

  // For single-line fields, cap at 1 line
  const effectiveMaxLines = fieldType === "textarea" ? maxLines : 1;

  // Calculate total max characters
  const maxChars = charsPerLine * effectiveMaxLines;

  // Recommended length is 80% of max for safety
  const recommendedLength = Math.floor(maxChars * 0.8);

  return {
    maxChars,
    charsPerLine,
    maxLines: effectiveMaxLines,
    recommendedLength,
    fontSizePt,
  };
}

/**
 * Get character limits formatted for AI prompt
 */
export function formatCharacterLimitsForPrompt(
  coordinates: NormalizedCoordinates,
  fieldType: FieldType,
  pageDimensions?: PageDimensions
): string {
  // Use default page dimensions if not provided (standard letter size at 96 DPI)
  const dims = pageDimensions || {
    widthPx: 816, // 8.5 inches * 96 DPI
    heightPx: 1056, // 11 inches * 96 DPI
    dpi: 96,
  };

  const limits = calculateCharacterLimits(coordinates, dims, fieldType);

  if (fieldType === "textarea") {
    return `MAX: ${limits.maxChars} chars (${limits.charsPerLine} chars/line × ${limits.maxLines} lines). RECOMMENDED: ${limits.recommendedLength} chars.`;
  }

  return `MAX: ${limits.maxChars} chars. RECOMMENDED: ${limits.recommendedLength} chars.`;
}

/**
 * Calculate limits for all fields on a page
 */
export function calculateFieldLimitsForPage(
  fields: Array<{
    id: string;
    coordinates: NormalizedCoordinates;
    field_type: FieldType;
  }>,
  pageDimensions?: PageDimensions
): Map<string, CharacterLimits> {
  const dims = pageDimensions || {
    widthPx: 816,
    heightPx: 1056,
    dpi: 96,
  };

  const limitsMap = new Map<string, CharacterLimits>();

  for (const field of fields) {
    const limits = calculateCharacterLimits(
      field.coordinates,
      dims,
      field.field_type
    );
    limitsMap.set(field.id, limits);
  }

  return limitsMap;
}

/**
 * Validate that a value fits within field limits
 */
export function validateValueLength(
  value: string,
  limits: CharacterLimits
): { valid: boolean; message?: string } {
  if (value.length > limits.maxChars) {
    return {
      valid: false,
      message: `Value exceeds max length (${value.length}/${limits.maxChars} chars)`,
    };
  }

  if (value.length > limits.recommendedLength) {
    return {
      valid: true,
      message: `Value near max length (${value.length}/${limits.maxChars} chars)`,
    };
  }

  return { valid: true };
}
