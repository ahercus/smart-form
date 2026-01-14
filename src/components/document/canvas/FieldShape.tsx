"use client";

/**
 * FieldShape - Composite field renderer that delegates to appropriate shape
 *
 * Wraps field shapes in a draggable Group for pointer mode manipulation.
 * Routes to:
 * - TextFieldShape for text, textarea, date
 * - CheckboxFieldShape for checkbox
 * - SignatureFieldShape for signature, initials
 * - ChoiceFieldShape for circle_choice
 */

import { Group } from "react-konva";
import type Konva from "konva";
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
  /** Whether in pointer mode (draggable) */
  draggable?: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
  onDblClick?: () => void;
  onDragEnd?: (x: number, y: number) => void;
  onTransformEnd?: (node: Konva.Group) => void;
  onChoiceClick?: (optionLabel: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Ref callback to register this shape for transformer */
  shapeRef?: (node: Konva.Group | null) => void;
}

export function FieldShape({
  field,
  value,
  pageWidth,
  pageHeight,
  isActive,
  isEditing,
  draggable = false,
  hideFieldColors,
  onClick,
  onDblClick,
  onDragEnd,
  onTransformEnd,
  onChoiceClick,
  onMouseEnter,
  onMouseLeave,
  shapeRef,
}: FieldShapeProps) {
  // Convert percentage coordinates to pixels
  const x = (field.coordinates.left / 100) * pageWidth;
  const y = (field.coordinates.top / 100) * pageHeight;
  const width = (field.coordinates.width / 100) * pageWidth;
  const height = (field.coordinates.height / 100) * pageHeight;

  // Handle drag end
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (onDragEnd) {
      onDragEnd(e.target.x(), e.target.y());
    }
  };

  // Handle transform end
  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    if (onTransformEnd) {
      onTransformEnd(e.target as Konva.Group);
    }
  };

  // Render the appropriate shape content (at 0,0 since parent Group handles position)
  const renderContent = () => {
    switch (field.field_type) {
      case "checkbox":
        return (
          <CheckboxFieldShape
            field={field}
            value={value}
            x={0}
            y={0}
            width={width}
            height={height}
            isActive={isActive}
            hideFieldColors={hideFieldColors}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          />
        );

      case "signature":
      case "initials":
        return (
          <SignatureFieldShape
            field={field}
            value={value}
            x={0}
            y={0}
            width={width}
            height={height}
            isActive={isActive}
            hideFieldColors={hideFieldColors}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          />
        );

      case "circle_choice":
        // ChoiceFieldShape uses its own coordinate system for options
        return (
          <ChoiceFieldShape
            field={field}
            value={value}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            isActive={isActive}
            hideFieldColors={hideFieldColors}
            onClick={onChoiceClick || (() => {})}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
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
            x={0}
            y={0}
            width={width}
            height={height}
            isActive={isActive}
            isEditing={isEditing}
            hideFieldColors={hideFieldColors}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          />
        );
    }
  };

  // For circle_choice, don't wrap in positioned Group (it handles its own positioning)
  if (field.field_type === "circle_choice") {
    return renderContent();
  }

  // Wrap in draggable Group
  return (
    <Group
      ref={shapeRef}
      x={x}
      y={y}
      width={width}
      height={height}
      draggable={draggable}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
    >
      {renderContent()}
    </Group>
  );
}
