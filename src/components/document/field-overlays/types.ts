import type { ExtractedField, NormalizedCoordinates, SignatureType } from "@/lib/types";

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
  /** Called when clicking on a signature/initials field - opens SignatureManager */
  onSignatureClick?: (fieldId: string, type: SignatureType) => void;
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

export function isSignatureField(fieldType: string): boolean {
  return fieldType === "signature" || fieldType === "initials";
}

export function getSignatureFieldClasses(
  isActive: boolean,
  isHighlighted: boolean,
  isFilled: boolean,
  hasImageValue: boolean = false
): string {
  // If filled with an image, show minimal styling (just the image, only show border when active)
  if (isFilled && hasImageValue) {
    return `w-full h-full transition-colors ${
      isActive
        ? "ring-2 ring-blue-500 ring-offset-1"
        : isHighlighted
          ? "ring-2 ring-purple-400 ring-offset-1"
          : "hover:ring-1 hover:ring-gray-300"
    }`;
  }

  return `w-full h-full border-2 border-dashed transition-colors ${
    isActive
      ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500 ring-offset-1"
      : isHighlighted
        ? "border-purple-500 bg-purple-500/10 ring-2 ring-purple-400 ring-offset-1"
        : "border-red-400 bg-red-400/5 hover:bg-red-400/10"
  }`;
}
