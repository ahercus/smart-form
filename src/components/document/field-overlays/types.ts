import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

export interface PixelCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseFieldOverlayProps {
  field: ExtractedField;
  value: string;
  pixelCoords: PixelCoordinates;
  isActive: boolean;
  isHighlighted: boolean;
  isFilled: boolean;
  onClick: (fieldId: string) => void;
  onDoubleClick: (fieldId: string) => void;
}

export interface EditableFieldOverlayProps extends BaseFieldOverlayProps {
  onValueChange: (fieldId: string, value: string) => void;
  onBlur: () => void;
  containerWidth: number;
}

export interface DraggableFieldOverlayProps extends BaseFieldOverlayProps {
  coords: NormalizedCoordinates;
  containerSize: { width: number; height: number };
  onCoordinatesChange: (fieldId: string, coords: NormalizedCoordinates) => void;
  onLocalCoordsChange: (fieldId: string, coords: NormalizedCoordinates) => void;
  pixelToPercent: (x: number, y: number, width: number, height: number) => NormalizedCoordinates;
}

export function getFieldClasses(isActive: boolean, isHighlighted: boolean, isFilled: boolean): string {
  return `w-full h-full border-2 transition-colors ${
    isActive
      ? "border-blue-500 bg-blue-500/20 ring-2 ring-blue-500 ring-offset-1"
      : isHighlighted
        ? "border-purple-500 bg-purple-500/20 ring-2 ring-purple-400 ring-offset-1"
        : isFilled
          ? "border-green-500 bg-green-500/10 hover:bg-green-500/20"
          : "border-orange-400 bg-orange-400/10 hover:bg-orange-400/20"
  }`;
}
