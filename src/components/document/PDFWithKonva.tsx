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
import { PDFControls, type EditMode } from "./PDFControls";
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
  onFieldClick?: (fieldId: string) => void;
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

// PDF page dimensions in points (letter size)
const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;

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
  const [editMode, setEditMode] = useState<EditMode>("type");
  const [hideFieldColors, setHideFieldColors] = useState(false);
  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatureFieldContext, setSignatureFieldContext] = useState<{
    fieldId: string;
    type: SignatureType;
  } | null>(null);
  const [deletedFieldIds, setDeletedFieldIds] = useState<Set<string>>(new Set());

  // Calculate scaled dimensions
  const scaledWidth = containerWidth * scale;
  const pageAspectRatio = PDF_PAGE_HEIGHT / PDF_PAGE_WIDTH;
  const scaledHeight = scaledWidth * pageAspectRatio;

  // Configure PDF.js worker
  useEffect(() => {
    import("react-pdf").then((pdfjs) => {
      pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`;
      setIsPdfJsReady(true);
    });
  }, []);

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

  // Page render callback - captures canvas as image
  const handlePageRenderSuccess = useCallback((pageNumber: number, canvas: HTMLCanvasElement) => {
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

  // Field interaction handlers
  const handleFieldClick = useCallback((fieldId: string) => {
    onFieldClick?.(fieldId);
    onNavigateToQuestion?.(fieldId);
  }, [onFieldClick, onNavigateToQuestion]);

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
    const defaultCoords: NormalizedCoordinates = {
      left: 35,
      top: 40,
      width: 30,
      height: 4,
    };
    onFieldAdd?.(currentPage, defaultCoords);
  }, [currentPage, onFieldAdd]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PDFControls
        currentPage={currentPage}
        numPages={numPages}
        scale={scale}
        editMode={editMode}
        activeFieldId={activeFieldId || null}
        hideFieldColors={hideFieldColors}
        isMobile={isMobile}
        onPageChange={onPageChange}
        onScaleChange={setScale}
        onEditModeChange={setEditMode}
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
        id="pdf-konva-container"
        data-scroll-container
        className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center"
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
                      width={scaledWidth}
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
                  pageWidth={scaledWidth}
                  pageHeight={scaledHeight}
                  scale={1} // Scale already applied to dimensions
                  fields={pageFields}
                  fieldValues={fieldValues}
                  activeFieldId={activeFieldId || null}
                  editMode={editMode}
                  showGrid={false} // Grid hidden from users
                  hideFieldColors={hideFieldColors}
                  onFieldClick={handleFieldClick}
                  onFieldValueChange={onFieldChange}
                  onFieldCoordinatesChange={onFieldCoordinatesChange}
                  onChoiceToggle={handleChoiceToggle}
                  onEditModeChange={setEditMode}
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
