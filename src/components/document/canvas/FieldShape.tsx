"use client";

/**
 * FieldShape - Composite field renderer that delegates to appropriate shape
 *
 * Routes to:
 * - TextFieldShape for text, textarea, date
 * - CheckboxFieldShape for checkbox
 * - SignatureFieldShape for signature, initials
 * - ChoiceFieldShape for circle_choice
 */

import { TextFieldShape } from "./TextFieldShape";
import { CheckboxFieldShape } from "./CheckboxFieldShape";
import { SignatureFieldShape } from "./SignatureFieldShape";
import { ChoiceFieldShape } from "./ChoiceFieldShape";
import type { ExtractedField } from "@/lib/types";

interface FieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Page dimensions for coordinate conversion */
  pageWidth: number;
  pageHeight: number;
  isActive: boolean;
  isEditing: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
  onChoiceClick?: (optionLabel: string) => void;
}

export function FieldShape({
  field,
  value,
  pageWidth,
  pageHeight,
  isActive,
  isEditing,
  hideFieldColors,
  onClick,
  onChoiceClick,
}: FieldShapeProps) {
  // Convert percentage coordinates to pixels
  const x = (field.coordinates.left / 100) * pageWidth;
  const y = (field.coordinates.top / 100) * pageHeight;
  const width = (field.coordinates.width / 100) * pageWidth;
  const height = (field.coordinates.height / 100) * pageHeight;

  switch (field.field_type) {
    case "checkbox":
      return (
        <CheckboxFieldShape
          field={field}
          value={value}
          x={x}
          y={y}
          width={width}
          height={height}
          isActive={isActive}
          hideFieldColors={hideFieldColors}
          onClick={onClick}
        />
      );

    case "signature":
    case "initials":
      return (
        <SignatureFieldShape
          field={field}
          value={value}
          x={x}
          y={y}
          width={width}
          height={height}
          isActive={isActive}
          hideFieldColors={hideFieldColors}
          onClick={onClick}
        />
      );

    case "circle_choice":
      return (
        <ChoiceFieldShape
          field={field}
          value={value}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          isActive={isActive}
          hideFieldColors={hideFieldColors}
          onClick={onChoiceClick || (() => {})}
        />
      );

    case "text":
    case "textarea":
    case "date":
    default:
      return (
        <TextFieldShape
          field={field}
          value={value}
          x={x}
          y={y}
          width={width}
          height={height}
          isActive={isActive}
          isEditing={isEditing}
          hideFieldColors={hideFieldColors}
          onClick={onClick}
        />
      );
  }
}
