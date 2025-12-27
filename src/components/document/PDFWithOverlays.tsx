"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { PDFControls, type EditMode } from "./PDFControls";
import {
  EditableFieldOverlay,
  DraggableFieldOverlay,
  ReadonlyFieldOverlay,
} from "./field-overlays";
import { SignatureManager } from "@/components/signature";
import { useCoordinateConversion } from "@/hooks/pdf/useCoordinateConversion";
import { useFieldKeyboardShortcuts } from "@/hooks/pdf/useFieldKeyboardShortcuts";
import type { ExtractedField, NormalizedCoordinates, SignatureType } from "@/lib/types";

// Dynamically import react-pdf to avoid SSR issues
const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
);

// Hidden page capture component - waits for full render before capturing
function HiddenPageCapture({
  pageNum,
  width,
  onPageRender,
}: {
  pageNum: number;
  width: number;
  onPageRender?: (pageNumber: number, canvas: HTMLCanvasElement) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleRenderSuccess = useCallback(() => {
    if (onPageRender && containerRef.current) {
      const canvas = containerRef.current.querySelector("canvas");
      if (canvas) {
        onPageRender(pageNum, canvas);
      }
    }
  }, [pageNum, onPageRender]);

  return (
    <div ref={containerRef}>
      <Page
        pageNumber={pageNum}
        width={width}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onRenderSuccess={handleRenderSuccess}
      />
    </div>
  );
}

// Dynamically import Document (Page already imported above)
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false }
);

interface PDFWithOverlaysProps {
  url: string;
  fields: ExtractedField[];
  fieldValues: Record<string, string>;
  currentPage: number;
  onPageChange: (page: number) => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onFieldClick?: (fieldId: string) => void;
  onFieldCoordinatesChange?: (fieldId: string, coords: NormalizedCoordinates) => void;
  onFieldCopy?: (fieldId: string) => void;
  onFieldDelete?: (fieldId: string) => void;
  onFieldAdd?: (pageNumber: number, coords: NormalizedCoordinates) => void;
  onNavigateToQuestion?: (fieldId: string) => void;
  activeFieldId?: string | null;
  highlightedFieldIds?: string[];
  onPageRender?: (pageNumber: number, canvas: HTMLCanvasElement) => void;
  onLoadError?: () => void;
  scrollToFieldId?: string | null;
}

export function PDFWithOverlays({
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
}: PDFWithOverlaysProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(600);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [isDocumentLoaded, setIsDocumentLoaded] = useState(false);
  const [isPdfJsReady, setIsPdfJsReady] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("type");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [localCoords, setLocalCoords] = useState<Record<string, NormalizedCoordinates>>({});
  const [deletedFieldIds, setDeletedFieldIds] = useState<Set<string>>(new Set());
  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureFieldContext, setSignatureFieldContext] = useState<{
    fieldId: string;
    type: SignatureType;
  } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Custom hooks
  const { percentToPixel, pixelToPercent } = useCoordinateConversion(containerSize);

  useFieldKeyboardShortcuts({
    activeFieldId: activeFieldId || null,
    onDelete: (fieldId) => {
      setEditingFieldId(null);
      setDeletedFieldIds((prev) => new Set([...prev, fieldId]));
      onFieldDelete?.(fieldId);
    },
    onStartEditing: (fieldId) => setEditingFieldId(fieldId),
    onStopEditing: () => setEditingFieldId(null),
  });

  // Scroll to field when scrollToFieldId changes
  useEffect(() => {
    if (scrollToFieldId && containerRef.current) {
      const field = fields.find((f) => f.id === scrollToFieldId);
      if (field && field.page_number === currentPage) {
        const coords = field.coordinates;
        const scrollContainer = containerRef.current.closest(".overflow-auto");
        if (scrollContainer) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const fieldCenterY =
            (coords.top / 100) * containerRect.height +
            ((coords.height / 100) * containerRect.height) / 2;
          const scrollContainerRect = scrollContainer.getBoundingClientRect();
          const targetScrollTop =
            scrollContainer.scrollTop + fieldCenterY - scrollContainerRect.height / 2;
          scrollContainer.scrollTo({ top: targetScrollTop, behavior: "smooth" });
        }
      }
    }
  }, [scrollToFieldId, fields, currentPage]);

  // Clear local state when fields update from DB
  useEffect(() => {
    setLocalCoords({});
    setDeletedFieldIds(new Set());
  }, [fields]);

  // Configure PDF.js worker on client side only
  useEffect(() => {
    import("react-pdf").then((pdfjs) => {
      pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`;
      setIsPdfJsReady(true);
    });
  }, []);

  // Reset document state when URL changes
  useEffect(() => {
    setIsDocumentLoaded(false);
    setNumPages(0);
    setPageError(false);
  }, [url]);

  // Update container width and track container size for percentage conversion
  useEffect(() => {
    const updateSize = () => {
      const container = document.getElementById("pdf-container");
      if (container) {
        setContainerWidth(container.clientWidth - 32);
      }
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [isDocumentLoaded, scale]);

  // Update container size when page renders
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, [isDocumentLoaded, currentPage, scale]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setIsDocumentLoaded(true);
    setPageError(false);
    console.log("[AutoForm] PDF loaded:", { numPages });
  };

  const onDocumentLoadError = useCallback(
    (error: Error) => {
      console.error("[AutoForm] PDF load error:", error.message);
      setPageError(true);
      onLoadError?.();
    },
    [onLoadError]
  );

  const onPageLoadError = useCallback(() => {
    console.warn("[AutoForm] Page load error, will retry on next render");
    setPageError(true);
    setTimeout(() => setPageError(false), 100);
  }, []);

  const onPageRenderSuccess = useCallback(() => {
    if (onPageRender && pageRef.current) {
      const canvas = pageRef.current.querySelector("canvas");
      if (canvas) {
        onPageRender(currentPage, canvas);
      }
    }
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, [currentPage, onPageRender]);

  // Filter fields for current page
  // Show all non-deleted fields (azure_di, gemini_vision, gemini_refinement, manual)
  const pageFields = fields.filter(
    (f) =>
      f.page_number === currentPage &&
      !deletedFieldIds.has(f.id)
  );

  const handleFieldClick = (fieldId: string) => {
    onFieldClick?.(fieldId);
    onNavigateToQuestion?.(fieldId);
  };

  const handleFieldDoubleClick = (fieldId: string) => {
    if (editMode === "pointer") {
      setEditMode("type");
    }
    setEditingFieldId(fieldId);
    onFieldClick?.(fieldId);
  };

  const handleFieldBlur = () => {
    setEditingFieldId(null);
  };

  const handleLocalCoordsChange = (fieldId: string, coords: NormalizedCoordinates) => {
    setLocalCoords((prev) => ({ ...prev, [fieldId]: coords }));
  };

  const handleAddField = () => {
    const defaultCoords: NormalizedCoordinates = {
      left: 35,
      top: 40,
      width: 30,
      height: 4,
    };
    onFieldAdd?.(currentPage, defaultCoords);
  };

  const handleCopyField = () => {
    if (activeFieldId) {
      onFieldCopy?.(activeFieldId);
    }
  };

  const handleDeleteField = () => {
    if (activeFieldId) {
      setDeletedFieldIds((prev) => new Set([...prev, activeFieldId]));
      onFieldDelete?.(activeFieldId);
    }
  };

  const handleSignatureClick = (fieldId: string, type: SignatureType) => {
    setSignatureFieldContext({ fieldId, type });
    setShowSignatureManager(true);
    onFieldClick?.(fieldId);
  };

  const handleSignatureInsert = (dataUrl: string) => {
    if (signatureFieldContext) {
      onFieldChange(signatureFieldContext.fieldId, dataUrl);
      setSignatureFieldContext(null);
    }
  };

  const handleSignatureManagerClose = (open: boolean) => {
    setShowSignatureManager(open);
    if (!open) {
      setSignatureFieldContext(null);
    }
  };

  const renderFieldOverlay = (field: ExtractedField) => {
    const coords = localCoords[field.id] || field.coordinates;
    const isActive = field.id === activeFieldId;
    const isHighlighted = highlightedFieldIds.includes(field.id);
    const isEditing = field.id === editingFieldId;
    const value = fieldValues[field.id] || "";
    const isFilled = value.trim().length > 0;
    const pixelCoords = percentToPixel(coords);

    // Editing mode - show input/textarea
    if (isEditing && editMode === "type") {
      return (
        <EditableFieldOverlay
          key={field.id}
          field={field}
          value={value}
          pixelCoords={pixelCoords}
          isActive={isActive}
          isHighlighted={isHighlighted}
          isFilled={isFilled}
          onClick={handleFieldClick}
          onDoubleClick={handleFieldDoubleClick}
          onValueChange={onFieldChange}
          onBlur={handleFieldBlur}
          containerWidth={containerSize.width}
          onSignatureClick={handleSignatureClick}
        />
      );
    }

    // Pointer mode - draggable/resizable
    if (editMode === "pointer" && containerSize.width > 0) {
      return (
        <DraggableFieldOverlay
          key={field.id}
          field={field}
          value={value}
          pixelCoords={pixelCoords}
          coords={coords}
          containerSize={containerSize}
          isActive={isActive}
          isHighlighted={isHighlighted}
          isFilled={isFilled}
          onClick={handleFieldClick}
          onDoubleClick={handleFieldDoubleClick}
          onCoordinatesChange={onFieldCoordinatesChange || (() => {})}
          onLocalCoordsChange={handleLocalCoordsChange}
          pixelToPercent={pixelToPercent}
          onSignatureClick={handleSignatureClick}
        />
      );
    }

    // Type mode (not editing) - readonly overlay
    return (
      <ReadonlyFieldOverlay
        key={field.id}
        field={field}
        value={value}
        pixelCoords={pixelCoords}
        isActive={isActive}
        isHighlighted={isHighlighted}
        isFilled={isFilled}
        onClick={handleFieldClick}
        onDoubleClick={handleFieldDoubleClick}
        onSignatureClick={handleSignatureClick}
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      <PDFControls
        currentPage={currentPage}
        numPages={numPages}
        scale={scale}
        editMode={editMode}
        activeFieldId={activeFieldId || null}
        onPageChange={onPageChange}
        onScaleChange={setScale}
        onEditModeChange={setEditMode}
        onAddField={handleAddField}
        onCopyField={handleCopyField}
        onDeleteField={handleDeleteField}
        onOpenSignatureManager={() => setShowSignatureManager(true)}
      />

      <SignatureManager
        open={showSignatureManager}
        onOpenChange={handleSignatureManagerClose}
        onInsert={signatureFieldContext ? handleSignatureInsert : undefined}
        initialTab={signatureFieldContext?.type || "signature"}
      />

      {/* PDF Display */}
      <div
        id="pdf-container"
        className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center"
      >
        {!isPdfJsReady ? (
          <Skeleton className="h-[600px] w-[450px]" />
        ) : (
          <Document
            key={url}
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="space-y-2">
                <Skeleton className="h-[600px] w-[450px]" />
              </div>
            }
            error={
              <div className="flex flex-col items-center justify-center p-8 h-[600px] w-[450px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Refreshing PDF...</p>
              </div>
            }
          >
            <div className="relative shadow-lg" ref={pageRef}>
              {isDocumentLoaded && !pageError && (
                <Page
                  pageNumber={currentPage}
                  width={containerWidth * scale}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<Skeleton className="h-[600px] w-[450px]" />}
                  onRenderSuccess={onPageRenderSuccess}
                  onLoadError={onPageLoadError}
                />
              )}
              {(!isDocumentLoaded || pageError) && (
                <Skeleton className="h-[600px] w-[450px]" />
              )}
              {/* Field overlays */}
              {isDocumentLoaded && !pageError && (
                <div className="absolute inset-0" ref={containerRef}>
                  {pageFields.map((field) => renderFieldOverlay(field))}
                </div>
              )}
            </div>

            {/* Hidden pages for background capture - uses onRenderSuccess to ensure full quality */}
            {isDocumentLoaded && numPages > 1 && (
              <div
                className="absolute -left-[9999px] opacity-0 pointer-events-none"
                aria-hidden="true"
              >
                {Array.from({ length: numPages }, (_, i) => i + 1)
                  .filter((pageNum) => pageNum !== currentPage)
                  .map((pageNum) => (
                    <HiddenPageCapture
                      key={`hidden-${pageNum}`}
                      pageNum={pageNum}
                      width={containerWidth * scale}
                      onPageRender={onPageRender}
                    />
                  ))}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}
