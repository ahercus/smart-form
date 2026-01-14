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
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import { GridLayer } from "./GridLayer";
import { FieldShape } from "./FieldShape";
import { FloatingInput } from "./FloatingInput";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

export type EditMode = "type" | "pointer";

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
  /** Current edit mode */
  editMode?: EditMode;
  /** Whether to show the grid */
  showGrid?: boolean;
  /** Whether to hide field background colors (for cleaner export preview) */
  hideFieldColors?: boolean;
  /** Callbacks */
  onFieldClick: (fieldId: string) => void;
  onFieldValueChange: (fieldId: string, value: string) => void;
  onFieldCoordinatesChange?: (fieldId: string, coords: NormalizedCoordinates) => void;
  onChoiceToggle?: (fieldId: string, optionLabel: string) => void;
  onEditModeChange?: (mode: EditMode) => void;
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
  editMode = "type",
  showGrid = false,
  hideFieldColors = false,
  onFieldClick,
  onFieldValueChange,
  onFieldCoordinatesChange,
  onChoiceToggle,
  onEditModeChange,
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

  // State for canvas panning
  const [isOverField, setIsOverField] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Update transformer when active field changes in pointer mode
  useEffect(() => {
    if (editMode !== "pointer" || !transformerRef.current) {
      transformerRef.current?.nodes([]);
      return;
    }

    if (activeFieldId) {
      const node = shapeRefs.current.get(activeFieldId);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    } else {
      transformerRef.current.nodes([]);
    }
  }, [activeFieldId, editMode]);

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

  // Handle field click - behavior depends on edit mode
  const handleFieldClick = useCallback(
    (field: ExtractedField) => {
      onFieldClick(field.id);

      if (editMode === "type") {
        // Type mode: immediately edit text fields, toggle checkboxes
        if (["text", "textarea", "date"].includes(field.field_type)) {
          startEditing(field);
        }
        if (field.field_type === "checkbox") {
          const currentValue = fieldValues[field.id] || "";
          const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
          onFieldValueChange(field.id, newValue);
        }
      }
      // Pointer mode: just select (handled by onFieldClick), no editing
    },
    [editMode, onFieldClick, onFieldValueChange, fieldValues, startEditing]
  );

  // Handle double-click - enter type mode and start editing
  const handleFieldDoubleClick = useCallback(
    (field: ExtractedField) => {
      if (editMode === "pointer") {
        // Switch to type mode and start editing
        onEditModeChange?.("type");
        if (["text", "textarea", "date"].includes(field.field_type)) {
          startEditing(field);
        }
        if (field.field_type === "checkbox") {
          const currentValue = fieldValues[field.id] || "";
          const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
          onFieldValueChange(field.id, newValue);
        }
      }
    },
    [editMode, onEditModeChange, onFieldValueChange, fieldValues, startEditing]
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

  // Track when mouse enters/leaves field shapes
  const handleFieldMouseEnter = useCallback(() => {
    setIsOverField(true);
  }, []);

  const handleFieldMouseLeave = useCallback(() => {
    setIsOverField(false);
  }, []);

  // Panning handlers - scroll the parent container
  const handlePanStart = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Only pan if not clicking on a field
      if (isOverField) return;

      // Find scrollable parent
      const scrollParent = containerRef.current?.closest("[data-scroll-container]") as HTMLElement | null;
      if (!scrollParent) return;

      setIsPanning(true);
      panStartRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        scrollLeft: scrollParent.scrollLeft,
        scrollTop: scrollParent.scrollTop,
      };
    },
    [isOverField]
  );

  const handlePanMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!isPanning) return;

      const scrollParent = containerRef.current?.closest("[data-scroll-container]") as HTMLElement | null;
      if (!scrollParent) return;

      const dx = e.evt.clientX - panStartRef.current.x;
      const dy = e.evt.clientY - panStartRef.current.y;

      scrollParent.scrollLeft = panStartRef.current.scrollLeft - dx;
      scrollParent.scrollTop = panStartRef.current.scrollTop - dy;
    },
    [isPanning]
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Determine cursor style
  const getCursorStyle = () => {
    if (isPanning) return "grabbing";
    if (isOverField) return "pointer";
    return "grab";
  };

  // Scaled dimensions
  const scaledWidth = pageWidth * scale;
  const scaledHeight = pageHeight * scale;

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width: scaledWidth, height: scaledHeight, cursor: getCursorStyle() }}
    >
      <Stage
        ref={stageRef}
        width={scaledWidth}
        height={scaledHeight}
        scale={{ x: scale, y: scale }}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
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
              draggable={editMode === "pointer"}
              hideFieldColors={hideFieldColors}
              onClick={() => handleFieldClick(field)}
              onDblClick={() => handleFieldDoubleClick(field)}
              onDragEnd={(x, y) => handleFieldDragEnd(field, x, y)}
              onTransformEnd={(node) => handleTransformEnd(field, node)}
              onChoiceClick={(label) => handleChoiceClick(field.id, label)}
              onMouseEnter={handleFieldMouseEnter}
              onMouseLeave={handleFieldMouseLeave}
              shapeRef={(node) => {
                if (node) {
                  shapeRefs.current.set(field.id, node);
                } else {
                  shapeRefs.current.delete(field.id);
                }
              }}
            />
          ))}
          {/* Transformer for resize handles in pointer mode */}
          {editMode === "pointer" && (
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
