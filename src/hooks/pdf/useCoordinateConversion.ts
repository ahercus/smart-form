import { useCallback } from "react";
import type { NormalizedCoordinates } from "@/lib/types";

interface ContainerSize {
  width: number;
  height: number;
}

interface PixelCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useCoordinateConversion(containerSize: ContainerSize) {
  // Convert percentage coordinates to pixels
  const percentToPixel = useCallback(
    (coords: NormalizedCoordinates): PixelCoordinates => ({
      x: (coords.left / 100) * containerSize.width,
      y: (coords.top / 100) * containerSize.height,
      width: (coords.width / 100) * containerSize.width,
      height: (coords.height / 100) * containerSize.height,
    }),
    [containerSize]
  );

  // Convert pixel coordinates to percentages
  const pixelToPercent = useCallback(
    (x: number, y: number, width: number, height: number): NormalizedCoordinates => ({
      left: (x / containerSize.width) * 100,
      top: (y / containerSize.height) * 100,
      width: (width / containerSize.width) * 100,
      height: (height / containerSize.height) * 100,
    }),
    [containerSize]
  );

  return { percentToPixel, pixelToPercent };
}
