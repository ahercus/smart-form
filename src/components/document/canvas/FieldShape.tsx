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

import { useRef, useEffect } from "react";
import { Group, Rect } from "react-konva";
import Konva from "konva";
import { TextFieldShape } from "./TextFieldShape";
import { CheckboxFieldShape } from "./CheckboxFieldShape";
import { SignatureFieldShape } from "./SignatureFieldShape";
import { ChoiceFieldShape } from "./ChoiceFieldShape";
import { LinkedDateFieldShape } from "./LinkedDateFieldShape";
import type { ExtractedField } from "@/lib/types";

interface FieldShapeProps {
  field: ExtractedField;
  value: string;
  /** Page dimensions for coordinate conversion */
  pageWidth: number;
  pageHeight: number;
  /** Consistent font size for all text fields on this page (based on smallest field) */
  pageFontSize?: number | null;
  isActive: boolean;
  isEditing: boolean;
  /** Whether this is a newly created field (shows pulse animation) */
  isNew?: boolean;
  /** Whether in layout mode (draggable/resizable) */
  draggable?: boolean;
  hideFieldColors?: boolean;
  onClick: () => void;
  onDblClick?: () => void;
  onDragEnd?: (x: number, y: number) => void;
  onTransformEnd?: (node: Konva.Group) => void;
  onChoiceClick?: (optionLabel: string) => void;
  /** Ref callback to register this shape for transformer */
  shapeRef?: (node: Konva.Group | null) => void;
}

export function FieldShape({
  field,
  value,
  pageWidth,
  pageHeight,
  pageFontSize,
  isActive,
  isEditing,
  isNew = false,
  draggable = false,
  hideFieldColors,
  onClick,
  onDblClick,
  onDragEnd,
  onTransformEnd,
  onChoiceClick,
  shapeRef,
}: FieldShapeProps) {
  const pulseRef = useRef<Konva.Rect>(null);

  // Convert percentage coordinates to pixels
  const x = (field.coordinates.left / 100) * pageWidth;
  const y = (field.coordinates.top / 100) * pageHeight;
  const width = (field.coordinates.width / 100) * pageWidth;
  const height = (field.coordinates.height / 100) * pageHeight;

  // Pulse animation for new fields
  useEffect(() => {
    if (!isNew || !pulseRef.current) return;

    const node = pulseRef.current;
    const layer = node.getLayer();
    if (!layer) return;

    const anim = new Konva.Animation((frame: { time: number } | undefined) => {
      if (!frame) return;
      // Pulse opacity between 0.3 and 0.8 over 800ms
      const period = 800;
      const opacity = 0.3 + 0.5 * Math.abs(Math.sin((frame.time * Math.PI) / period));
      node.opacity(opacity);
    }, layer);

    anim.start();

    return () => {
      anim.stop();
    };
  }, [isNew]);

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
          />
        );

      case "date":
        // Check if this is a segmented date (has date_segments)
        console.log("[FieldShape] date field:", field.label, "date_segments:", field.date_segments);
        if (field.date_segments && field.date_segments.length > 0) {
          return (
            <LinkedDateFieldShape
              field={field}
              value={value}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              pageFontSize={pageFontSize}
              isActive={isActive}
              hideFieldColors={hideFieldColors}
              onClick={onClick}
            />
          );
        }
        // Fall through to default text rendering for simple date fields
        return (
          <TextFieldShape
            field={field}
            value={value}
            x={0}
            y={0}
            width={width}
            height={height}
            pageFontSize={pageFontSize}
            isActive={isActive}
            isEditing={isEditing}
            hideFieldColors={hideFieldColors}
            onClick={onClick}
          />
        );

      case "text":
      case "textarea":
      default:
        return (
          <TextFieldShape
            field={field}
            value={value}
            x={0}
            y={0}
            width={width}
            height={height}
            pageFontSize={pageFontSize}
            isActive={isActive}
            isEditing={isEditing}
            hideFieldColors={hideFieldColors}
            onClick={onClick}
          />
        );
    }
  };

  // For circle_choice and segmented dates, don't wrap in positioned Group (they handle their own positioning)
  const isSegmentedDate = field.field_type === "date" && field.date_segments && field.date_segments.length > 0;
  if (field.field_type === "circle_choice" || isSegmentedDate) {
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
      {/* Pulse overlay for new fields */}
      {isNew && (
        <Rect
          ref={pulseRef}
          x={-2}
          y={-2}
          width={width + 4}
          height={height + 4}
          fill="transparent"
          stroke="#3b82f6"
          strokeWidth={2}
          cornerRadius={3}
          opacity={0.5}
        />
      )}
      {renderContent()}
    </Group>
  );
}
