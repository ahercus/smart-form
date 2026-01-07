"use client";

/**
 * SignatureFieldShape - Renders signature and initials fields on canvas
 *
 * Shows:
 * - Field box with colored border
 * - Signature image when value is a data URL
 * - Click opens signature manager
 */

import { Group, Rect, Image as KonvaImage } from "react-konva";
import { useEffect, useState } from "react";
import type { ExtractedField } from "@/lib/types";

interface SignatureFieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Pixel coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
}

// Signature = red, Initials = pink
const COLORS = {
  signature: "#ef4444",
  initials: "#ec4899",
};

export function SignatureFieldShape({
  field,
  value,
  x,
  y,
  width,
  height,
  isActive,
  hideFieldColors,
  onClick,
}: SignatureFieldShapeProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const color = field.field_type === "initials" ? COLORS.initials : COLORS.signature;
  const hasSignature = value && value.startsWith("data:image");

  // Load signature image
  useEffect(() => {
    if (!hasSignature) {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = value;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [value, hasSignature]);

  // Calculate image dimensions maintaining aspect ratio
  const getImageDimensions = () => {
    if (!image) return null;

    const imgAspect = image.width / image.height;
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

    return {
      x: x + offsetX,
      y: y + offsetY,
      width: drawWidth,
      height: drawHeight,
    };
  };

  // Determine styles
  const bgFill = hideFieldColors
    ? "transparent"
    : isActive
    ? `${color}15`
    : `${color}08`;

  const strokeColor = hideFieldColors ? "transparent" : isActive ? color : `${color}80`;
  const strokeWidth = isActive ? 1.5 : 1;

  const imageDims = getImageDimensions();

  return (
    <Group onClick={onClick} onTap={onClick}>
      {/* Field box */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={bgFill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        cornerRadius={2}
      />

      {/* Signature image */}
      {image && imageDims && (
        <KonvaImage
          image={image}
          x={imageDims.x}
          y={imageDims.y}
          width={imageDims.width}
          height={imageDims.height}
        />
      )}
    </Group>
  );
}
