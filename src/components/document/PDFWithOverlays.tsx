"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Rnd } from "react-rnd";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Type,
  MousePointer2,
  Copy,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

// Dynamically import react-pdf to avoid SSR issues
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false }
);
const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
);

type EditMode = "type" | "pointer";

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
  // Local coordinates for optimistic updates during drag/resize
  const [localCoords, setLocalCoords] = useState<Record<string, NormalizedCoordinates>>({});
  // Optimistically deleted field IDs
  const [deletedFieldIds, setDeletedFieldIds] = useState<Set<string>>(new Set());
  const pageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to field when scrollToFieldId changes
  useEffect(() => {
    if (scrollToFieldId && containerRef.current) {
      const field = fields.find((f) => f.id === scrollToFieldId);
      if (field && field.page_number === currentPage) {
        const coords = field.coordinates;
        const scrollContainer = containerRef.current.closest(".overflow-auto");
        if (scrollContainer) {
          // Calculate the field's center position within the scroll container
          const containerRect = containerRef.current.getBoundingClientRect();
          const fieldCenterY = (coords.top / 100) * containerRect.height + (coords.height / 100) * containerRect.height / 2;
          const scrollContainerRect = scrollContainer.getBoundingClientRect();
          const targetScrollTop = scrollContainer.scrollTop + fieldCenterY - scrollContainerRect.height / 2;
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

  // Handle keyboard shortcuts for field management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're focused on an input/textarea
      const activeElement = document.activeElement;
      const isInputFocused = activeElement instanceof HTMLInputElement ||
                             activeElement instanceof HTMLTextAreaElement;

      if (!activeFieldId) return;

      // Delete key removes the selected field (when not editing)
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused) {
        e.preventDefault();
        setEditingFieldId(null);
        setDeletedFieldIds((prev) => new Set([...prev, activeFieldId]));
        onFieldDelete?.(activeFieldId);
      }

      // Enter key starts editing the selected field (when not already editing)
      if (e.key === "Enter" && !isInputFocused) {
        e.preventDefault();
        setEditingFieldId(activeFieldId);
      }

      // Escape key deselects the field
      if (e.key === "Escape") {
        e.preventDefault();
        setEditingFieldId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFieldId, onFieldDelete]);

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
    // Update container size after page renders
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }
  }, [currentPage, onPageRender]);

  // Only show fields that have been enhanced by Gemini
  const pageFields = fields.filter(
    (f) =>
      f.page_number === currentPage &&
      !deletedFieldIds.has(f.id) &&
      (f.detection_source === "gemini_vision" ||
        f.detection_source === "gemini_refinement" ||
        f.detection_source === "manual")
  );

  const handleFieldClick = (fieldId: string) => {
    // Single click always selects the field
    onFieldClick?.(fieldId);
    onNavigateToQuestion?.(fieldId);
  };

  const handleFieldDoubleClick = (fieldId: string) => {
    // Double click starts editing (in either mode)
    if (editMode === "pointer") {
      setEditMode("type");
    }
    setEditingFieldId(fieldId);
    onFieldClick?.(fieldId);
  };

  const handleFieldBlur = () => {
    setEditingFieldId(null);
  };

  // Convert percentage coordinates to pixels
  const percentToPixel = useCallback(
    (coords: NormalizedCoordinates) => ({
      x: (coords.left / 100) * containerSize.width,
      y: (coords.top / 100) * containerSize.height,
      width: (coords.width / 100) * containerSize.width,
      height: (coords.height / 100) * containerSize.height,
    }),
    [containerSize]
  );

  // Convert pixel coordinates to percentages
  const pixelToPercent = useCallback(
    (x: number, y: number, width: number, height: number): NormalizedCoordinates => ({
      left: (x / containerSize.width) * 100,
      top: (y / containerSize.height) * 100,
      width: (width / containerSize.width) * 100,
      height: (height / containerSize.height) * 100,
    }),
    [containerSize]
  );

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

  const handleAddField = () => {
    // Add a new field in the center of the visible area
    const defaultCoords: NormalizedCoordinates = {
      left: 35,
      top: 40,
      width: 30,
      height: 4,
    };
    onFieldAdd?.(currentPage, defaultCoords);
  };

  const renderFieldOverlay = (field: ExtractedField) => {
    // Use local coords if available (during drag/resize), otherwise use field coords
    const coords = localCoords[field.id] || field.coordinates;
    const isActive = field.id === activeFieldId;
    const isHighlighted = highlightedFieldIds.includes(field.id);
    const isEditing = field.id === editingFieldId;
    const value = fieldValues[field.id] || "";
    const isFilled = value.trim().length > 0;

    const pixelCoords = percentToPixel(coords);

    // If editing in type mode, show input with blue border
    if (isEditing && editMode === "type") {
      // Use Input for date fields, Textarea for everything else
      const isDateField = field.field_type === "date";

      return (
        <div
          key={field.id}
          className="absolute z-20 border-2 border-blue-500 ring-2 ring-blue-500 ring-offset-1 bg-blue-500/10"
          style={{
            left: pixelCoords.x,
            top: pixelCoords.y,
            width: Math.max(pixelCoords.width, containerSize.width * 0.15),
            minHeight: pixelCoords.height,
          }}
        >
          {isDateField ? (
            <Input
              type="date"
              value={value}
              onChange={(e) => onFieldChange(field.id, e.target.value)}
              onBlur={handleFieldBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  handleFieldBlur();
                }
              }}
              className="h-full w-full text-xs p-1 bg-transparent border-0 focus:ring-0 focus-visible:ring-0"
              autoFocus
            />
          ) : (
            <Textarea
              value={value}
              onChange={(e) => {
                onFieldChange(field.id, e.target.value);
                // Auto-resize textarea
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              onBlur={handleFieldBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  handleFieldBlur();
                }
                // Allow Enter to add line breaks (don't prevent default)
              }}
              className="w-full text-xs p-1 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 resize-none overflow-hidden"
              style={{ minHeight: pixelCoords.height }}
              autoFocus
              rows={1}
            />
          )}
        </div>
      );
    }

    const baseClasses = `w-full h-full border-2 transition-colors ${
      isActive
        ? "border-blue-500 bg-blue-500/20 ring-2 ring-blue-500 ring-offset-1"
        : isHighlighted
          ? "border-purple-500 bg-purple-500/20 ring-2 ring-purple-400 ring-offset-1"
          : isFilled
            ? "border-green-500 bg-green-500/10 hover:bg-green-500/20"
            : "border-orange-400 bg-orange-400/10 hover:bg-orange-400/20"
    }`;

    // In pointer mode with active field, use react-rnd for drag/resize
    if (editMode === "pointer" && isActive && containerSize.width > 0) {
      return (
        <Rnd
          key={field.id}
          position={{ x: pixelCoords.x, y: pixelCoords.y }}
          size={{ width: pixelCoords.width, height: pixelCoords.height }}
          onDrag={(_e, d) => {
            // Optimistic update during drag - keep original width/height (in percent)
            const newCoords: NormalizedCoordinates = {
              left: (d.x / containerSize.width) * 100,
              top: (d.y / containerSize.height) * 100,
              width: coords.width,  // Preserve original percentage width
              height: coords.height, // Preserve original percentage height
            };
            setLocalCoords((prev) => ({ ...prev, [field.id]: newCoords }));
          }}
          onDragStop={(_e, d) => {
            const newCoords: NormalizedCoordinates = {
              left: (d.x / containerSize.width) * 100,
              top: (d.y / containerSize.height) * 100,
              width: coords.width,
              height: coords.height,
            };
            setLocalCoords((prev) => ({ ...prev, [field.id]: newCoords }));
            onFieldCoordinatesChange?.(field.id, newCoords);
          }}
          onResize={(_e, _direction, ref, _delta, position) => {
            // Optimistic update during resize - convert pixel dimensions to percent
            const newCoords = pixelToPercent(
              position.x,
              position.y,
              ref.offsetWidth,
              ref.offsetHeight
            );
            setLocalCoords((prev) => ({ ...prev, [field.id]: newCoords }));
          }}
          onResizeStop={(_e, _direction, ref, _delta, position) => {
            const newCoords = pixelToPercent(
              position.x,
              position.y,
              ref.offsetWidth,
              ref.offsetHeight
            );
            setLocalCoords((prev) => ({ ...prev, [field.id]: newCoords }));
            onFieldCoordinatesChange?.(field.id, newCoords);
          }}
          bounds="parent"
          minWidth={20}
          minHeight={10}
          resizeHandleStyles={{
            topLeft: { width: 10, height: 10, top: -5, left: -5, cursor: "nw-resize", background: "#3b82f6", borderRadius: 2, border: "1px solid white" },
            topRight: { width: 10, height: 10, top: -5, right: -5, cursor: "ne-resize", background: "#3b82f6", borderRadius: 2, border: "1px solid white" },
            bottomLeft: { width: 10, height: 10, bottom: -5, left: -5, cursor: "sw-resize", background: "#3b82f6", borderRadius: 2, border: "1px solid white" },
            bottomRight: { width: 10, height: 10, bottom: -5, right: -5, cursor: "se-resize", background: "#3b82f6", borderRadius: 2, border: "1px solid white" },
          }}
          resizeHandleClasses={{
            topLeft: "z-30",
            topRight: "z-30",
            bottomLeft: "z-30",
            bottomRight: "z-30",
          }}
          enableResizing={{
            top: false,
            right: false,
            bottom: false,
            left: false,
            topLeft: true,
            topRight: true,
            bottomLeft: true,
            bottomRight: true,
          }}
          className="z-10"
        >
          <div
            className={`${baseClasses} cursor-move group relative`}
            onDoubleClick={() => handleFieldDoubleClick(field.id)}
            title={`${field.label}${value ? `: ${value}` : ""}`}
          >
            {isFilled && (
              <span className="absolute inset-0 px-1 text-xs text-gray-700 dark:text-gray-300 pointer-events-none whitespace-pre-wrap overflow-hidden">
                {value}
              </span>
            )}
            <div className="absolute -top-6 left-0 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
              {field.label}
            </div>
          </div>
        </Rnd>
      );
    }

    // Non-active fields or type mode - simple div overlay
    return (
      <div
        key={field.id}
        className={`absolute cursor-pointer group ${baseClasses}`}
        style={{
          left: pixelCoords.x,
          top: pixelCoords.y,
          width: pixelCoords.width,
          height: pixelCoords.height,
        }}
        onClick={() => handleFieldClick(field.id)}
        onDoubleClick={() => handleFieldDoubleClick(field.id)}
        title={`${field.label}${value ? `: ${value}` : ""}`}
      >
        {isFilled && (
          <span className="absolute inset-0 px-1 text-xs text-gray-700 dark:text-gray-300 pointer-events-none whitespace-pre-wrap overflow-hidden">
            {value}
          </span>
        )}
        <div className="absolute -top-6 left-0 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
          {field.label}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        {/* Left: Page navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[80px] text-center">
            Page {currentPage} of {numPages || "..."}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(Math.min(numPages, currentPage + 1))}
            disabled={currentPage >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Center: Edit mode tools */}
        <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
          <Button
            variant={editMode === "type" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setEditMode("type")}
            title="Type mode - click to edit field values"
          >
            <Type className="h-4 w-4" />
          </Button>
          <Button
            variant={editMode === "pointer" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setEditMode("pointer")}
            title="Pointer mode - move and resize fields"
          >
            <MousePointer2 className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleAddField}
            title="Add new field"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopyField}
            disabled={!activeFieldId}
            title="Copy selected field"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleDeleteField}
            disabled={!activeFieldId}
            title="Delete selected field (Delete key)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Zoom controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScale((s) => Math.min(2, s + 0.25))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

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

          {/* Hidden pages for background capture - renders all pages not currently visible */}
          {isDocumentLoaded && numPages > 1 && (
            <div className="absolute -left-[9999px] opacity-0 pointer-events-none" aria-hidden="true">
              {Array.from({ length: numPages }, (_, i) => i + 1)
                .filter((pageNum) => pageNum !== currentPage)
                .map((pageNum) => (
                  <div
                    key={`hidden-${pageNum}`}
                    ref={(el) => {
                      // Capture canvas after it renders
                      if (el && onPageRender) {
                        const observer = new MutationObserver(() => {
                          const canvas = el.querySelector("canvas");
                          if (canvas) {
                            onPageRender(pageNum, canvas);
                            observer.disconnect();
                          }
                        });
                        observer.observe(el, { childList: true, subtree: true });
                        // Check if already rendered
                        const canvas = el.querySelector("canvas");
                        if (canvas) {
                          onPageRender(pageNum, canvas);
                          observer.disconnect();
                        }
                      }
                    }}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={containerWidth * scale}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </div>
                ))}
            </div>
          )}
        </Document>
        )}
      </div>
    </div>
  );
}
