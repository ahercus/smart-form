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
  /** When true, hides background colors but keeps hover effects and functionality */
  hideFieldColors?: boolean;
  onClick: (fieldId: string) => void;
  onDoubleClick: (fieldId: string) => void;
  /** Called when clicking on a signature/initials field - opens SignatureManager */
  onSignatureClick?: (fieldId: string, type: SignatureType) => void;
  /** Called when clicking on a filled signature to switch to pointer mode */
  onSwitchToPointerMode?: () => void;
  /** Called when toggling checkbox or selecting choice option */
  onValueChange?: (fieldId: string, value: string) => void;
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

export function getFieldClasses(isActive: boolean, isHighlighted: boolean, isFilled: boolean, hideFieldColors?: boolean): string {
  // When hideFieldColors is true, show no colors by default but reveal on hover (only active field keeps styling)
  if (hideFieldColors && !isActive) {
    return `w-full h-full transition-colors hover:bg-gray-500/10`;
  }

  // Subtle fill visible by default, slightly more opaque on hover
  // No borders unless active/highlighted, single border (no ring)
  return `w-full h-full transition-colors ${
    isActive
      ? "border-2 border-blue-500 bg-blue-500/15"
      : isHighlighted
        ? "border-2 border-primary bg-primary/15"
        : isFilled
          ? "bg-green-500/10 hover:bg-green-500/20"
          : "bg-orange-400/10 hover:bg-orange-400/20"
  }`;
}

export function isSignatureField(fieldType: string): boolean {
  return fieldType === "signature" || fieldType === "initials";
}

export function isCheckboxField(fieldType: string): boolean {
  return fieldType === "checkbox";
}

export function getCheckboxClasses(
  isActive: boolean,
  isHighlighted: boolean,
  isChecked: boolean,
  hideFieldColors?: boolean
): string {
  // When hideFieldColors is true, show no colors by default but reveal on hover (only active field keeps styling)
  if (hideFieldColors && !isActive) {
    return `w-full h-full flex items-center justify-center transition-colors hover:bg-gray-500/10`;
  }

  return `w-full h-full flex items-center justify-center transition-colors ${
    isActive
      ? "border-2 border-blue-500 bg-blue-500/15"
      : isHighlighted
        ? "border-2 border-primary bg-primary/15"
        : isChecked
          ? "bg-green-500/15 hover:bg-green-500/25"
          : "bg-orange-400/10 hover:bg-orange-400/20"
  }`;
}

export function getSignatureFieldClasses(
  isActive: boolean,
  isHighlighted: boolean,
  isFilled: boolean,
  hasImageValue: boolean = false,
  hideFieldColors?: boolean
): string {
  // If filled with an image, show minimal styling (just the image, only show border when active)
  if (isFilled && hasImageValue) {
    return `w-full h-full transition-colors ${
      isActive
        ? "ring-2 ring-blue-500 ring-offset-1"
        : isHighlighted
          ? "ring-2 ring-primary ring-offset-1"
          : "hover:ring-1 hover:ring-gray-300"
    }`;
  }

  // When hideFieldColors is true, show no colors by default but reveal on hover (only active field keeps styling)
  if (hideFieldColors && !isActive) {
    return `w-full h-full transition-colors hover:bg-gray-500/10 hover:border hover:border-dashed hover:border-gray-400`;
  }

  return `w-full h-full border-2 border-dashed transition-colors ${
    isActive
      ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500 ring-offset-1"
      : isHighlighted
        ? "border-primary bg-primary/10 ring-2 ring-primary ring-offset-1"
        : "border-red-400 bg-red-400/5 hover:bg-red-400/10"
  }`;
}
