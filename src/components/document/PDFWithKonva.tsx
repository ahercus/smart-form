"use client";

/**
 * PDFWithKonva - WYSIWYG PDF viewer with Konva canvas rendering
 *
 * Replaces DOM-based field overlays with Konva canvas for pixel-perfect
 * rendering that matches exactly across devices and exports.
 *
 * Architecture:
 * 1. react-pdf renders PDF to a hidden canvas
 * 2. Canvas is captured as an image
 * 3. KonvaFieldCanvas displays the image with field overlays
 * 4. Export uses stage.toDataURL() for WYSIWYG output
 */

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { Stage as StageType } from "konva/lib/Stage";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { PDFControls } from "./PDFControls";
import { KonvaFieldCanvas, useCanvasExport } from "./canvas";
import { SignatureManager } from "@/components/signature";
import type { ExtractedField, NormalizedCoordinates, SignatureType } from "@/lib/types";

// Dynamically import react-pdf to avoid SSR issues
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false }
);

const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
);

interface PDFWithKonvaProps {
  url: string;
  fields: ExtractedField[];
  fieldValues: Record<string, string>;
  currentPage: number;
  onPageChange: (page: number) => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onFieldClick?: (fieldId: string | null) => void;
  onFieldCoordinatesChange?: (fieldId: string, coords: NormalizedCoordinates) => void;
  onFieldCopy?: (fieldId: string) => void;
  onFieldDelete?: (fieldId: string) => void;
  onFieldAdd?: (pageNumber: number, coords: NormalizedCoordinates, fieldType?: string, initialValue?: string) => void;
  onNavigateToQuestion?: (fieldId: string) => void;
  activeFieldId?: string | null;
  highlightedFieldIds?: string[];
  onPageRender?: (pageNumber: number, canvas: HTMLCanvasElement) => void;
  onLoadError?: () => void;
  scrollToFieldId?: string | null;
  isMobile?: boolean;
  /** Ref to access Konva stage for export */
  stageRef?: React.RefObject<StageType>;
}

export function PDFWithKonva({
  url,
  fields,
  fieldValues,
  currentPage,
  onPageChange,
  onFieldChange,
  onFieldClick,
  onFieldCoordinatesChange,
  onFieldCopy,
  onFieldDelete,
  onFieldAdd,
  onNavigateToQuestion,
  activeFieldId,
  highlightedFieldIds = [],
  onPageRender,
  onLoadError,
  scrollToFieldId,
  isMobile,
  stageRef: externalStageRef,
}: PDFWithKonvaProps) {
  const internalStageRef = useRef<StageType>(null);
  const stageRef = externalStageRef || internalStageRef;

  // PDF state
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(600);
  const [isDocumentLoaded, setIsDocumentLoaded] = useState(false);
  const [isPdfJsReady, setIsPdfJsReady] = useState(false);
  const [pageError, setPageError] = useState(false);

  // Page images captured from react-pdf
  const [pageImages, setPageImages] = useState<Map<number, HTMLImageElement>>(new Map());
  const [currentPageImage, setCurrentPageImage] = useState<HTMLImageElement | null>(null);

  // UI state
  const [layoutMode, setLayoutMode] = useState(false);
  const [hideFieldColors, setHideFieldColors] = useState(false);
  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureFieldContext, setSignatureFieldContext] = useState<{
    fieldId: string;
    type: SignatureType;
  } | null>(null);
  const [deletedFieldIds, setDeletedFieldIds] = useState<Set<string>>(new Set());
  // Track newly created field for pulse animation (cleared on interaction)
  const [newFieldId, setNewFieldId] = useState<string | null>(null);
  const [expectingNewField, setExpectingNewField] = useState(false);
  // Track actual page dimensions from rendered canvas (not hardcoded)
  const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());
  const [localCoords, setLocalCoords] = useState<Record<string, NormalizedCoordinates>>({});

  // Base dimensions from actual page dimensions
  const baseWidth = containerWidth;
  const currentPageDims = pageDimensions.get(currentPage);
  // Default to letter aspect ratio until we get actual dimensions
  const pageAspectRatio = currentPageDims
    ? currentPageDims.height / currentPageDims.width
    : 792 / 612;
  const baseHeight = baseWidth * pageAspectRatio;
  const scaledWidth = baseWidth * scale;
  const scaledHeight = baseHeight * scale;

  // Pinch zoom state
  const lastTouchDistance = useRef<number | null>(null);
  const pinchStartScale = useRef<number>(1);
  const rafScaleRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Configure PDF.js worker
  useEffect(() => {
    import("react-pdf").then((pdfjs) => {
      pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`;
      setIsPdfJsReady(true);
    });
  }, []);

  // Pinch zoom for mobile + trackpad
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyScale = (nextScale: number) => {
      const clamped = Math.max(0.5, Math.min(3, nextScale));
      rafScaleRef.current = clamped;

      if (rafIdRef.current !== null) return;

      rafIdRef.current = window.requestAnimationFrame(() => {
        if (rafScaleRef.current !== null) {
          setScale(rafScaleRef.current);
        }
        rafIdRef.current = null;
      });
    };

    // Trackpad pinch (wheel with ctrlKey)
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        applyScale(scale + delta);
      }
    };

    // Mobile touch pinch
    const getTouchDistance = (touches: TouchList) => {
      if (touches.length < 2) return null;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastTouchDistance.current = getTouchDistance(e.touches);
        pinchStartScale.current = scale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDistance.current !== null) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        if (currentDistance !== null) {
          const scaleFactor = currentDistance / lastTouchDistance.current;
          const nextScale = pinchStartScale.current * scaleFactor;
          applyScale(nextScale);
        }
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance.current = null;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [scale]);

  // Update container width
  useEffect(() => {
    const updateWidth = () => {
      const container = document.getElementById("pdf-konva-container");
      if (container) {
        setContainerWidth(container.clientWidth - 32);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Reset state when URL changes
  useEffect(() => {
    setIsDocumentLoaded(false);
    setNumPages(0);
    setPageError(false);
    setPageImages(new Map());
    setPageDimensions(new Map());
    setCurrentPageImage(null);
  }, [url]);

  // Update current page image when page changes
  useEffect(() => {
    const img = pageImages.get(currentPage);
    if (img) {
      setCurrentPageImage(img);
    }
  }, [currentPage, pageImages]);

  // Clear deleted fields when fields update
  useEffect(() => {
    setDeletedFieldIds(new Set());
  }, [fields]);

  useEffect(() => {
    if (fields.length === 0) return;

    setLocalCoords((prev) => {
      const next: Record<string, NormalizedCoordinates> = { ...prev };
      const fieldMap = new Map(fields.map((f) => [f.id, f.coordinates]));

      for (const [fieldId, coords] of Object.entries(prev)) {
        const serverCoords = fieldMap.get(fieldId);
        if (!serverCoords) {
          delete next[fieldId];
          continue;
        }

        const isClose =
          Math.abs(coords.left - serverCoords.left) < 0.1 &&
          Math.abs(coords.top - serverCoords.top) < 0.1 &&
          Math.abs(coords.width - serverCoords.width) < 0.1 &&
          Math.abs(coords.height - serverCoords.height) < 0.1;

        if (isClose) {
          delete next[fieldId];
        }
      }

      return next;
    });
  }, [fields]);

  // Track when a new field is created (activeFieldId changes while expecting)
  useEffect(() => {
    if (expectingNewField && activeFieldId) {
      setNewFieldId(activeFieldId);
      setExpectingNewField(false);
    }
  }, [activeFieldId, expectingNewField]);

  // Document callbacks
  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setIsDocumentLoaded(true);
    setPageError(false);
    console.log("[AutoForm] PDF loaded:", { numPages });
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error("[AutoForm] PDF load error:", error.message);
    setPageError(true);
    onLoadError?.();
  }, [onLoadError]);

  // Page render callback - captures canvas as image and records actual dimensions
  const handlePageRenderSuccess = useCallback((pageNumber: number, canvas: HTMLCanvasElement) => {
    // Capture actual page dimensions from rendered canvas
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    setPageDimensions((prev) => {
      const next = new Map(prev);
      next.set(pageNumber, { width: canvasWidth, height: canvasHeight });
      return next;
    });

    console.log("[AutoForm] Page rendered:", { pageNumber, canvasWidth, canvasHeight, aspectRatio: canvasHeight / canvasWidth });

    // Convert canvas to image
    const dataUrl = canvas.toDataURL("image/png");
    const img = new window.Image();
    img.onload = () => {
      setPageImages((prev) => {
        const next = new Map(prev);
        next.set(pageNumber, img);
        return next;
      });

      // Update current page image if this is the current page
      if (pageNumber === currentPage) {
        setCurrentPageImage(img);
      }
    };
    img.src = dataUrl;

    // Also call external callback
    onPageRender?.(pageNumber, canvas);
  }, [currentPage, onPageRender]);

  // Filter fields for current page
  const pageFields = fields.filter(
    (f) => f.page_number === currentPage && !deletedFieldIds.has(f.id)
  );
  const mergedPageFields = pageFields.map((field) =>
    localCoords[field.id] ? { ...field, coordinates: localCoords[field.id] } : field
  );

  // Field interaction handlers
  const handleFieldClick = useCallback((fieldId: string | null) => {
    // Clear pulse animation on any field interaction
    if (newFieldId) {
      setNewFieldId(null);
    }
    onFieldClick?.(fieldId);
    if (fieldId) {
      onNavigateToQuestion?.(fieldId);
    }
  }, [onFieldClick, onNavigateToQuestion, newFieldId]);

  const handleChoiceToggle = useCallback((fieldId: string, optionLabel: string) => {
    const currentValue = fieldValues[fieldId] || "";
    const selected = currentValue.split(",").map((s) => s.trim()).filter(Boolean);
    const index = selected.indexOf(optionLabel);

    if (index >= 0) {
      selected.splice(index, 1);
    } else {
      selected.push(optionLabel);
    }

    onFieldChange(fieldId, selected.join(","));
  }, [fieldValues, onFieldChange]);

  const handleFieldCoordinatesChange = useCallback(
    (fieldId: string, coords: NormalizedCoordinates) => {
      setLocalCoords((prev) => ({ ...prev, [fieldId]: coords }));
      onFieldCoordinatesChange?.(fieldId, coords);
    },
    [onFieldCoordinatesChange]
  );

  // Signature handlers
  const handleSignatureClick = useCallback((fieldId: string, type: SignatureType) => {
    setSignatureFieldContext({ fieldId, type });
    setShowSignatureManager(true);
    onFieldClick?.(fieldId);
  }, [onFieldClick]);

  const handleSignatureInsert = useCallback((dataUrl: string, type: SignatureType) => {
    if (signatureFieldContext) {
      onFieldChange(signatureFieldContext.fieldId, dataUrl);
      setSignatureFieldContext(null);
    } else if (onFieldAdd) {
      const defaultCoords: NormalizedCoordinates = {
        left: 30,
        top: 40,
        width: 25,
        height: type === "initials" ? 4 : 6,
      };
      onFieldAdd(currentPage, defaultCoords, type === "initials" ? "initials" : "signature", dataUrl);
    }
  }, [signatureFieldContext, onFieldChange, onFieldAdd, currentPage]);

  // Control handlers
  const handleAddField = useCallback(() => {
    // Calculate viewport center to place field where user is looking
    const container = document.getElementById("pdf-konva-container");
    let centerLeftPercent = 35;
    let centerTopPercent = 40;

    if (container && scaledWidth > 0 && scaledHeight > 0) {
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;
      const viewportWidth = container.clientWidth;
      const viewportHeight = container.clientHeight;

      // Calculate center of visible area in pixels (accounting for padding)
      const centerX = scrollLeft + viewportWidth / 2 - 16;
      const centerY = scrollTop + viewportHeight / 2 - 16;

      // Convert to percentage coordinates
      centerLeftPercent = Math.max(5, Math.min(65, (centerX / scaledWidth) * 100));
      centerTopPercent = Math.max(5, Math.min(90, (centerY / scaledHeight) * 100));
    }

    // Calculate average dimensions from existing text fields on this page
    const pageTextFields = fields.filter(
      (f) => f.page_number === currentPage && ["text", "textarea", "date"].includes(f.field_type)
    );

    let fieldWidth = 15; // Default: half of previous 30%
    let fieldHeight = 2; // Default: half of previous 4%

    if (pageTextFields.length > 0) {
      // Calculate average width and height from existing text fields
      const totalWidth = pageTextFields.reduce((sum, f) => sum + f.coordinates.width, 0);
      const totalHeight = pageTextFields.reduce((sum, f) => sum + f.coordinates.height, 0);
      fieldWidth = totalWidth / pageTextFields.length;
      fieldHeight = totalHeight / pageTextFields.length;
    }

    const coords: NormalizedCoordinates = {
      left: centerLeftPercent,
      top: centerTopPercent,
      width: fieldWidth,
      height: fieldHeight,
    };
    // Mark that we're expecting a new field (to trigger pulse animation)
    setExpectingNewField(true);
    onFieldAdd?.(currentPage, coords);
    // Auto-enable layout mode so user can position the new field
    setLayoutMode(true);
  }, [currentPage, onFieldAdd, scaledWidth, scaledHeight, fields]);

  const handleCopyField = useCallback(() => {
    if (activeFieldId) {
      onFieldCopy?.(activeFieldId);
    }
  }, [activeFieldId, onFieldCopy]);

  const handleDeleteField = useCallback(() => {
    if (activeFieldId) {
      setDeletedFieldIds((prev) => new Set([...prev, activeFieldId]));
      onFieldDelete?.(activeFieldId);
    }
  }, [activeFieldId, onFieldDelete]);

  // Handle canvas background click - exit layout mode
  const handleStageBackgroundClick = useCallback(() => {
    if (layoutMode) {
      setLayoutMode(false);
    }
  }, [layoutMode]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PDFControls
        currentPage={currentPage}
        numPages={numPages}
        scale={scale}
        layoutMode={layoutMode}
        activeFieldId={activeFieldId || null}
        hideFieldColors={hideFieldColors}
        isMobile={isMobile}
        onPageChange={onPageChange}
        onScaleChange={setScale}
        onLayoutModeChange={setLayoutMode}
        onToggleFieldColors={() => setHideFieldColors((prev) => !prev)}
        onAddField={handleAddField}
        onCopyField={handleCopyField}
        onDeleteField={handleDeleteField}
        onOpenSignatureManager={() => setShowSignatureManager(true)}
      />

      <SignatureManager
        open={showSignatureManager}
        onOpenChange={(open) => {
          setShowSignatureManager(open);
          if (!open) setSignatureFieldContext(null);
        }}
        onInsert={handleSignatureInsert}
        initialTab={signatureFieldContext?.type || "signature"}
      />

      {/* PDF Display with Konva Canvas */}
      <div
        ref={containerRef}
        id="pdf-konva-container"
        data-scroll-container
        className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center touch-pan-x touch-pan-y"
      >
        {!isPdfJsReady ? (
          <Skeleton className="h-[600px] w-[450px]" />
        ) : (
          <>
            {/* Hidden react-pdf Document for canvas capture */}
            <div className="fixed left-[-9999px] top-0" aria-hidden="true">
              <Document
                key={url}
                file={url}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
              >
                {isDocumentLoaded &&
                  Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                    <HiddenPageRenderer
                      key={pageNum}
                      pageNumber={pageNum}
                      width={baseWidth}
                      onRenderSuccess={handlePageRenderSuccess}
                    />
                  ))}
              </Document>
            </div>

            {/* Konva Canvas display */}
            {isDocumentLoaded && !pageError ? (
              <div className="shadow-lg">
                <KonvaFieldCanvas
                  pageImage={currentPageImage}
                  pageWidth={baseWidth}
                  pageHeight={baseHeight}
                  scale={scale}
                  fields={mergedPageFields}
                  fieldValues={fieldValues}
                  activeFieldId={activeFieldId || null}
                  newFieldId={newFieldId}
                  layoutMode={layoutMode}
                  isMobile={isMobile}
                  showGrid={false} // Grid hidden from users
                  hideFieldColors={hideFieldColors}
                  onFieldClick={handleFieldClick}
                  onFieldValueChange={onFieldChange}
                  onFieldCoordinatesChange={handleFieldCoordinatesChange}
                  onChoiceToggle={handleChoiceToggle}
                  onStageBackgroundClick={handleStageBackgroundClick}
                  onDeleteActiveField={(fieldId) => {
                    setDeletedFieldIds((prev) => new Set([...prev, fieldId]));
                    onFieldDelete?.(fieldId);
                  }}
                  onSignatureClick={handleSignatureClick}
                  stageRef={stageRef}
                />
              </div>
            ) : pageError ? (
              <div className="flex flex-col items-center justify-center p-8 h-[600px] w-[450px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Refreshing PDF...</p>
              </div>
            ) : (
              <Skeleton className="h-[600px] w-[450px]" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hidden page renderer that captures canvas on render success
 */
function HiddenPageRenderer({
  pageNumber,
  width,
  onRenderSuccess,
}: {
  pageNumber: number;
  width: number;
  onRenderSuccess: (pageNumber: number, canvas: HTMLCanvasElement) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleRenderSuccess = useCallback(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector("canvas");
      if (canvas) {
        onRenderSuccess(pageNumber, canvas);
      }
    }
  }, [pageNumber, onRenderSuccess]);

  return (
    <div ref={containerRef}>
      <Page
        pageNumber={pageNumber}
        width={width}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onRenderSuccess={handleRenderSuccess}
      />
    </div>
  );
}

/**
 * Hook to export the current canvas state
 */
export { useCanvasExport } from "./canvas";
