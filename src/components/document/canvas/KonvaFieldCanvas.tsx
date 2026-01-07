"use client";

/**
 * KonvaFieldCanvas - Main canvas component for WYSIWYG field rendering
 *
 * Structure:
 * - Background layer: PDF page as image
 * - Grid layer: Dynamic grid for positioning reference
 * - Fields layer: All field shapes
 * - Floating input: HTML input overlay for text entry
 */

import { useRef, useCallback, useState, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import type { Stage as StageType } from "konva/lib/Stage";
import { GridLayer } from "./GridLayer";
import { FieldShape } from "./FieldShape";
import { FloatingInput } from "./FloatingInput";
import type { ExtractedField } from "@/lib/types";

interface KonvaFieldCanvasProps {
  /** PDF page rendered as image (data URL or HTMLImageElement) */
  pageImage: HTMLImageElement | null;
  /** Page dimensions in points */
  pageWidth: number;
  pageHeight: number;
  /** Scale factor for responsive sizing */
  scale: number;
  /** Fields for this page */
  fields: ExtractedField[];
  /** Field values (fieldId -> value) */
  fieldValues: Record<string, string>;
  /** Currently active field */
  activeFieldId: string | null;
  /** Whether to show the grid */
  showGrid?: boolean;
  /** Whether to hide field background colors (for cleaner export preview) */
  hideFieldColors?: boolean;
  /** Callbacks */
  onFieldClick: (fieldId: string) => void;
  onFieldValueChange: (fieldId: string, value: string) => void;
  onChoiceToggle?: (fieldId: string, optionLabel: string) => void;
  /** Ref to access stage for export */
  stageRef?: React.RefObject<StageType | null>;
}

export function KonvaFieldCanvas({
  pageImage,
  pageWidth,
  pageHeight,
  scale,
  fields,
  fieldValues,
  activeFieldId,
  showGrid = false,
  hideFieldColors = false,
  onFieldClick,
  onFieldValueChange,
  onChoiceToggle,
  stageRef: externalStageRef,
}: KonvaFieldCanvasProps) {
  const internalStageRef = useRef<StageType>(null);
  const stageRef = externalStageRef || internalStageRef;

  // State for text editing
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [inputPosition, setInputPosition] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Get the field being edited
  const editingField = editingFieldId
    ? fields.find((f) => f.id === editingFieldId)
    : null;

  // Handle field click - start editing for text fields
  const handleFieldClick = useCallback(
    (field: ExtractedField) => {
      onFieldClick(field.id);

      // Start editing for text-like fields
      if (["text", "textarea", "date"].includes(field.field_type)) {
        const x = (field.coordinates.left / 100) * pageWidth * scale;
        const y = (field.coordinates.top / 100) * pageHeight * scale;
        const width = (field.coordinates.width / 100) * pageWidth * scale;
        const height = (field.coordinates.height / 100) * pageHeight * scale;

        setEditingFieldId(field.id);
        setInputPosition({ x, y, width, height });
      }

      // Toggle checkbox
      if (field.field_type === "checkbox") {
        const currentValue = fieldValues[field.id] || "";
        const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
        onFieldValueChange(field.id, newValue);
      }
    },
    [onFieldClick, onFieldValueChange, fieldValues, pageWidth, pageHeight, scale]
  );

  // Handle choice option click
  const handleChoiceClick = useCallback(
    (fieldId: string, optionLabel: string) => {
      if (onChoiceToggle) {
        onChoiceToggle(fieldId, optionLabel);
      } else {
        // Default toggle behavior
        const currentValue = fieldValues[fieldId] || "";
        const selected = currentValue.split(",").map((s) => s.trim()).filter(Boolean);
        const index = selected.indexOf(optionLabel);

        if (index >= 0) {
          selected.splice(index, 1);
        } else {
          selected.push(optionLabel);
        }

        onFieldValueChange(fieldId, selected.join(","));
      }
      onFieldClick(fieldId);
    },
    [onChoiceToggle, onFieldValueChange, onFieldClick, fieldValues]
  );

  // Close floating input
  const handleInputClose = useCallback(() => {
    setEditingFieldId(null);
  }, []);

  // Handle click on empty space - close editing
  const handleStageClick = useCallback(
    (e: { target: { getStage: () => unknown } }) => {
      // If clicking on the stage background (not a field), close editing
      if (e.target === e.target.getStage()) {
        setEditingFieldId(null);
      }
    },
    []
  );

  // Scaled dimensions
  const scaledWidth = pageWidth * scale;
  const scaledHeight = pageHeight * scale;

  return (
    <div
      className="relative"
      style={{ width: scaledWidth, height: scaledHeight }}
    >
      <Stage
        ref={stageRef}
        width={scaledWidth}
        height={scaledHeight}
        scale={{ x: scale, y: scale }}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        {/* Background layer */}
        <Layer name="background">
          {/* White background fallback */}
          <Rect x={0} y={0} width={pageWidth} height={pageHeight} fill="white" />

          {/* PDF page image */}
          {pageImage && (
            <KonvaImage
              image={pageImage}
              x={0}
              y={0}
              width={pageWidth}
              height={pageHeight}
            />
          )}
        </Layer>

        {/* Grid layer */}
        <Layer name="grid">
          <GridLayer
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            scale={scale}
            visible={showGrid}
          />
        </Layer>

        {/* Fields layer */}
        <Layer name="fields">
          {fields.map((field) => (
            <FieldShape
              key={field.id}
              field={field}
              value={fieldValues[field.id] || ""}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              isActive={field.id === activeFieldId}
              isEditing={field.id === editingFieldId}
              hideFieldColors={hideFieldColors}
              onClick={() => handleFieldClick(field)}
              onChoiceClick={(label) => handleChoiceClick(field.id, label)}
            />
          ))}
        </Layer>
      </Stage>

      {/* Floating input for text editing */}
      {editingField && (
        <FloatingInput
          field={editingField}
          value={fieldValues[editingField.id] || ""}
          position={inputPosition}
          scale={scale}
          onValueChange={onFieldValueChange}
          onClose={handleInputClose}
        />
      )}
    </div>
  );
}

/**
 * Hook to capture canvas as image for export
 */
export function useCanvasExport(stageRef: React.RefObject<StageType>) {
  const exportToDataURL = useCallback(
    (pixelRatio: number = 4): string | null => {
      if (!stageRef.current) return null;
      return stageRef.current.toDataURL({ pixelRatio });
    },
    [stageRef]
  );

  const exportToBlob = useCallback(
    async (pixelRatio: number = 4): Promise<Blob | null> => {
      if (!stageRef.current) return null;

      return new Promise((resolve) => {
        stageRef.current!.toBlob({
          pixelRatio,
          callback: (blob) => resolve(blob),
        });
      });
    },
    [stageRef]
  );

  return { exportToDataURL, exportToBlob };
}

/**
 * Hook to capture a specific region for QC screenshots
 */
export function useClusterCapture(stageRef: React.RefObject<StageType>) {
  const captureCluster = useCallback(
    (
      bounds: { top: number; left: number; bottom: number; right: number },
      pageWidth: number,
      pageHeight: number,
      pixelRatio: number = 2
    ): string | null => {
      if (!stageRef.current) return null;

      const x = (bounds.left / 100) * pageWidth;
      const y = (bounds.top / 100) * pageHeight;
      const width = ((bounds.right - bounds.left) / 100) * pageWidth;
      const height = ((bounds.bottom - bounds.top) / 100) * pageHeight;

      return stageRef.current.toDataURL({
        x,
        y,
        width,
        height,
        pixelRatio,
      });
    },
    [stageRef]
  );

  return { captureCluster };
}
