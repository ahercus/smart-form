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
import type { ExtractedField, NormalizedCoordinates, SignatureType } from "@/lib/types";

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
  /** Called when user presses delete on a selected field */
  onDeleteActiveField?: (fieldId: string) => void;
  /** Called when a signature/initials field is clicked */
  onSignatureClick?: (fieldId: string, type: SignatureType) => void;
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
  onDeleteActiveField,
  onSignatureClick,
  stageRef: externalStageRef,
}: KonvaFieldCanvasProps) {
  const internalStageRef = useRef<StageType>(null);
  const stageRef = externalStageRef || internalStageRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panMovedRef = useRef(false);
  const panStartRef = useRef({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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

  useEffect(() => {
    if (!containerRef.current) return;
    scrollContainerRef.current =
      (containerRef.current.closest("[data-scroll-container]") as HTMLElement | null) || null;
  }, []);

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
      if (isDraggingRef.current) {
        return;
      }

      if (layoutMode) {
        onFieldClick(field.id);
        return;
      }

      if (field.field_type === "signature" || field.field_type === "initials") {
        onFieldClick(field.id);
        onSignatureClick?.(field.id, field.field_type as SignatureType);
        return;
      }

      // Checkbox: toggle immediately (no selection state)
      if (field.field_type === "checkbox") {
        const currentValue = fieldValues[field.id] || "";
        const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
        onFieldValueChange(field.id, newValue);
        onFieldClick(field.id);
        return;
      }

      // On mobile: single tap = select + edit for text fields
      if (isMobile && isTextType(field)) {
        onFieldClick(field.id);
        startEditing(field);
        return;
      }

      // Desktop: single click enters edit mode for text fields
      if (isTextType(field)) {
        onFieldClick(field.id);
        startEditing(field);
      } else {
        onFieldClick(field.id);
      }
    },
    [isMobile, isTextType, layoutMode, onFieldClick, onFieldValueChange, fieldValues, startEditing]
  );

  // Handle double-click - always enters edit mode for text fields
  const handleFieldDoubleClick = useCallback(
    (field: ExtractedField) => {
      if (layoutMode) {
        onStageBackgroundClick?.();
      }

      if (field.field_type === "signature" || field.field_type === "initials") {
        onFieldClick(field.id);
        onSignatureClick?.(field.id, field.field_type as SignatureType);
        return;
      }

      if (field.field_type === "checkbox") {
        const currentValue = fieldValues[field.id] || "";
        const newValue = currentValue === "yes" || currentValue === "true" ? "" : "yes";
        onFieldValueChange(field.id, newValue);
        onFieldClick(field.id);
        return;
      }

      if (isTextType(field)) {
        onFieldClick(field.id);
        startEditing(field);
      }
    },
    [fieldValues, isTextType, layoutMode, onFieldClick, onFieldValueChange, onSignatureClick, onStageBackgroundClick, startEditing]
  );

  // Handle field drag end - update coordinates
  const handleFieldDragEnd = useCallback(
    (field: ExtractedField, newX: number, newY: number) => {
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 100);

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

  const startPan = useCallback((clientX: number, clientY: number) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    isPanningRef.current = true;
    panMovedRef.current = false;
    panStartRef.current = {
      x: clientX,
      y: clientY,
      scrollLeft: scrollContainer.scrollLeft,
      scrollTop: scrollContainer.scrollTop,
    };
    setIsPanning(true);
  }, []);

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;

      const layerName = e.target.getLayer?.()?.name?.();
      const isBackgroundClick =
        e.target === e.target.getStage() ||
        (layerName && layerName !== "fields");

      if (!isBackgroundClick) return;

      startPan(e.evt.clientX, e.evt.clientY);
    },
    [startPan]
  );

  const handleStageTouchStart = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      if (e.evt.touches.length !== 1) return;
      // In layout mode, don't pan — let fields be dragged instead
      if (layoutMode) return;

      const layerName = e.target.getLayer?.()?.name?.();
      const isBackgroundClick =
        e.target === e.target.getStage() ||
        (layerName && layerName !== "fields");

      if (!isBackgroundClick) return;

      const touch = e.evt.touches[0];
      startPan(touch.clientX, touch.clientY);
    },
    [startPan, layoutMode]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;

      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;

      if (!panMovedRef.current && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        panMovedRef.current = true;
      }

      scrollContainer.scrollLeft = panStartRef.current.scrollLeft - dx;
      scrollContainer.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const handleUp = () => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (!isPanningRef.current || e.touches.length !== 1) return;
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;

      const touch = e.touches[0];
      const dx = touch.clientX - panStartRef.current.x;
      const dy = touch.clientY - panStartRef.current.y;

      if (!panMovedRef.current && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        panMovedRef.current = true;
      }

      scrollContainer.scrollLeft = panStartRef.current.scrollLeft - dx;
      scrollContainer.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const handleTouchEnd = () => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setIsPanning(false);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

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
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (panMovedRef.current) {
        panMovedRef.current = false;
        return;
      }

      const layerName = e.target.getLayer?.()?.name?.();
      const isBackgroundClick =
        e.target === e.target.getStage() ||
        (layerName && layerName !== "fields");

      if (isBackgroundClick) {
        setEditingFieldId(null);
        onFieldClick(null);
        onStageBackgroundClick?.();
      }
    },
    [onFieldClick, onStageBackgroundClick]
  );

  // Keyboard listener for type-to-edit (desktop only)
  useEffect(() => {
    // Skip if no field selected or on mobile
    if (!activeFieldId || isMobile) return;

    const field = fields.find((f) => f.id === activeFieldId);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        activeFieldId &&
        !editingFieldId
      ) {
        e.preventDefault();
        onDeleteActiveField?.(activeFieldId);
        return;
      }

      if (!field || editingFieldId || !isTextType(field)) return;

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
  }, [activeFieldId, editingFieldId, isMobile, fields, isTextType, layoutMode, startEditing, onDeleteActiveField, onFieldClick]);

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
      className={`relative ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ width: scaledWidth, height: scaledHeight }}
    >
      <Stage
        ref={stageRef}
        width={scaledWidth}
        height={scaledHeight}
        scale={{ x: scale, y: scale }}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageTouchStart}
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
              draggable={layoutMode ? field.id !== editingFieldId : (!isMobile && field.id !== editingFieldId)}
              hideFieldColors={hideFieldColors}
              onClick={() => handleFieldClick(field)}
              onDblClick={() => handleFieldDoubleClick(field)}
              onDragStart={() => {
                isDraggingRef.current = true;
                setEditingFieldId(null);
                onFieldClick(field.id);
              }}
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
              anchorSize={isMobile ? 14 : 10}
              anchorCornerRadius={isMobile ? 7 : 0}
              borderStrokeWidth={isMobile ? 2 : 1}
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
