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
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from "react-konva";
import type { Stage as StageType } from "konva/lib/Stage";
import type Konva from "konva";
import { GridLayer } from "./GridLayer";
import { FieldShape } from "./FieldShape";
import { FloatingInput } from "./FloatingInput";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

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
  /** Newly created field ID (for pulse animation) */
  newFieldId?: string | null;
  /** Layout editing mode - enables drag/resize of fields */
  layoutMode?: boolean;
  /** Whether on mobile device - affects interaction behavior */
  isMobile?: boolean;
  /** Whether to show the grid */
  showGrid?: boolean;
  /** Whether to hide field background colors (for cleaner export preview) */
  hideFieldColors?: boolean;
  /** Callbacks */
  onFieldClick: (fieldId: string | null) => void;
  onFieldValueChange: (fieldId: string, value: string) => void;
  onFieldCoordinatesChange?: (fieldId: string, coords: NormalizedCoordinates) => void;
  onChoiceToggle?: (fieldId: string, optionLabel: string) => void;
  /** Called when user clicks on the stage background (not a field) */
  onStageBackgroundClick?: () => void;
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
  newFieldId,
  layoutMode = false,
  isMobile = false,
  showGrid = false,
  hideFieldColors = false,
  onFieldClick,
  onFieldValueChange,
  onFieldCoordinatesChange,
  onChoiceToggle,
  onStageBackgroundClick,
  stageRef: externalStageRef,
}: KonvaFieldCanvasProps) {
  const internalStageRef = useRef<StageType>(null);
  const stageRef = externalStageRef || internalStageRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

  // State for text editing
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [inputPosition, setInputPosition] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Update transformer when active field changes in layout mode
  // Also re-run when fields change (for newly added fields)
  useEffect(() => {
    if (!layoutMode || !transformerRef.current) {
      transformerRef.current?.nodes([]);
      return;
    }

    if (activeFieldId) {
      // Use a short delay to ensure the field has been rendered
      const timer = setTimeout(() => {
        const node = shapeRefs.current.get(activeFieldId);
        if (node && transformerRef.current) {
          transformerRef.current.nodes([node]);
          transformerRef.current.getLayer()?.batchDraw();
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      transformerRef.current.nodes([]);
    }
  }, [activeFieldId, layoutMode, fields]);

  // Get the field being edited
  const editingField = editingFieldId
    ? fields.find((f) => f.id === editingFieldId)
    : null;

  // Start text editing for a field
  const startEditing = useCallback(
    (field: ExtractedField) => {
      if (!["text", "textarea", "date"].includes(field.field_type)) return;

      const x = (field.coordinates.left / 100) * pageWidth * scale;
      const y = (field.coordinates.top / 100) * pageHeight * scale;
      const width = (field.coordinates.width / 100) * pageWidth * scale;
      const height = (field.coordinates.height / 100) * pageHeight * scale;

      setEditingFieldId(field.id);
      setInputPosition({ x, y, width, height });
    },
    [pageWidth, pageHeight, scale]
  );

  // Helper to check if field is a text-type field
  const isTextType = useCallback((field: ExtractedField) => {
    return ["text", "textarea", "date"].includes(field.field_type);
  }, []);

  // Handle field click - Google Slides-like interaction
  const handleFieldClick = useCallback(
    (field: ExtractedField) => {
      // Checkbox: toggle immediately (no selection state)
      if (field.field_type === "checkbox") {
        const currentValue = fieldValues[field.id] || "";
        const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
        onFieldValueChange(field.id, newValue);
        return;
      }

      // On mobile: single tap = select + edit for text fields
      if (isMobile && isTextType(field)) {
        onFieldClick(field.id);
        startEditing(field);
        return;
      }

      // Desktop: click selected field to edit, or just select
      if (activeFieldId === field.id) {
        // Already selected - enter edit mode
        if (isTextType(field)) {
          startEditing(field);
        }
      } else {
        // Select the field
        onFieldClick(field.id);
      }
    },
    [activeFieldId, isMobile, isTextType, onFieldClick, onFieldValueChange, fieldValues, startEditing]
  );

  // Handle double-click - always enters edit mode for text fields
  const handleFieldDoubleClick = useCallback(
    (field: ExtractedField) => {
      if (isTextType(field)) {
        onFieldClick(field.id);
        startEditing(field);
      }
    },
    [isTextType, onFieldClick, startEditing]
  );

  // Handle field drag end - update coordinates
  const handleFieldDragEnd = useCallback(
    (field: ExtractedField, newX: number, newY: number) => {
      if (!onFieldCoordinatesChange) return;

      const newCoords: NormalizedCoordinates = {
        left: (newX / pageWidth) * 100,
        top: (newY / pageHeight) * 100,
        width: field.coordinates.width,
        height: field.coordinates.height,
      };
      onFieldCoordinatesChange(field.id, newCoords);
    },
    [onFieldCoordinatesChange, pageWidth, pageHeight]
  );

  // Handle transform end (resize) - update coordinates
  const handleTransformEnd = useCallback(
    (field: ExtractedField, node: Konva.Group) => {
      if (!onFieldCoordinatesChange) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      // Reset scale and apply to width/height
      node.scaleX(1);
      node.scaleY(1);

      const newCoords: NormalizedCoordinates = {
        left: (node.x() / pageWidth) * 100,
        top: (node.y() / pageHeight) * 100,
        width: (node.width() * scaleX / pageWidth) * 100,
        height: (node.height() * scaleY / pageHeight) * 100,
      };
      onFieldCoordinatesChange(field.id, newCoords);
    },
    [onFieldCoordinatesChange, pageWidth, pageHeight]
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

  // Handle click on empty space - close editing, deselect, and notify parent
  const handleStageClick = useCallback(
    (e: { target: { getStage: () => unknown } }) => {
      // If clicking on the stage background (not a field), close editing and deselect
      if (e.target === e.target.getStage()) {
        setEditingFieldId(null);
        onFieldClick(null);
        // Notify parent (e.g., to exit layout mode)
        onStageBackgroundClick?.();
      }
    },
    [onFieldClick, onStageBackgroundClick]
  );

  // Keyboard listener for type-to-edit (desktop only)
  useEffect(() => {
    // Skip if no field selected, already editing, or on mobile
    if (!activeFieldId || editingFieldId || isMobile) return;

    const field = fields.find((f) => f.id === activeFieldId);
    if (!field || !isTextType(field)) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Printable character - start editing
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        startEditing(field);
      } else if (e.key === "Enter") {
        startEditing(field);
        e.preventDefault();
      } else if (e.key === "Escape") {
        onFieldClick(null); // Deselect
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFieldId, editingFieldId, isMobile, fields, isTextType, startEditing, onFieldClick]);

  // Scaled dimensions
  const scaledWidth = pageWidth * scale;
  const scaledHeight = pageHeight * scale;

  // Calculate consistent font size based on smallest text field on this page
  // This ensures all text fields use the same font size for visual consistency
  const textFields = fields.filter((f) =>
    ["text", "textarea", "date"].includes(f.field_type)
  );
  const pageFontSize = textFields.length > 0
    ? (() => {
        const minHeightPx = Math.min(
          ...textFields.map((f) => (f.coordinates.height / 100) * pageHeight)
        );
        // Use 75% of smallest field height, clamped between 10-24px
        return Math.min(Math.max(minHeightPx * 0.75, 10), 24);
      })()
    : null;

  return (
    <div
      ref={containerRef}
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
              pageFontSize={pageFontSize}
              isActive={field.id === activeFieldId}
              isEditing={field.id === editingFieldId}
              isNew={field.id === newFieldId}
              draggable={layoutMode}
              hideFieldColors={hideFieldColors}
              onClick={() => handleFieldClick(field)}
              onDblClick={() => handleFieldDoubleClick(field)}
              onDragEnd={(x, y) => handleFieldDragEnd(field, x, y)}
              onTransformEnd={(node) => handleTransformEnd(field, node)}
              onChoiceClick={(label) => handleChoiceClick(field.id, label)}
              shapeRef={(node) => {
                if (node) {
                  shapeRefs.current.set(field.id, node);
                } else {
                  shapeRefs.current.delete(field.id);
                }
              }}
            />
          ))}
          {/* Transformer for resize handles in layout mode */}
          {layoutMode && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Limit minimum size
                if (newBox.width < 10 || newBox.height < 10) {
                  return oldBox;
                }
                return newBox;
              }}
              rotateEnabled={false}
              keepRatio={false}
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
                "middle-left",
                "middle-right",
                "top-center",
                "bottom-center",
              ]}
            />
          )}
        </Layer>
      </Stage>

      {/* Floating input for text editing */}
      {editingField && (
        <FloatingInput
          field={editingField}
          value={fieldValues[editingField.id] || ""}
          position={inputPosition}
          scale={scale}
          pageFontSize={pageFontSize}
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
