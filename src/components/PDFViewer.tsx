"use client";

import { useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  fields: ExtractedField[];
  currentFieldId: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onFieldClick?: (fieldId: string) => void;
}

export function PDFViewer({
  url,
  fields,
  currentFieldId,
  currentPage,
  onPageChange,
  onFieldClick,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const updateWidth = () => {
      const container = document.getElementById("pdf-container");
      if (container) {
        setContainerWidth(container.clientWidth - 32);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const pageFields = fields.filter((f) => f.page_number === currentPage);

  const renderFieldOverlay = (
    field: ExtractedField,
    coords: NormalizedCoordinates
  ) => {
    const isActive = field.id === currentFieldId;
    const isFilled = field.value !== null && field.value !== "";

    return (
      <div
        key={field.id}
        className={`absolute border-2 cursor-pointer transition-all ${
          isActive
            ? "border-blue-500 bg-blue-500/20 ring-2 ring-blue-500 ring-offset-1"
            : isFilled
              ? "border-green-500 bg-green-500/10"
              : "border-orange-400 bg-orange-400/10 hover:bg-orange-400/20"
        }`}
        style={{
          left: `${coords.left}%`,
          top: `${coords.top}%`,
          width: `${coords.width}%`,
          height: `${coords.height}%`,
        }}
        onClick={() => onFieldClick?.(field.id)}
        title={field.label}
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
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
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 bg-muted/30 flex justify-center"
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="space-y-2">
              <Skeleton className="h-[600px] w-[450px]" />
            </div>
          }
          error={
            <div className="text-destructive text-center p-4">
              Failed to load PDF
            </div>
          }
        >
          <div className="relative shadow-lg">
            <Page
              pageNumber={currentPage}
              width={containerWidth * scale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              loading={<Skeleton className="h-[600px] w-[450px]" />}
            />
            {/* Field overlays */}
            <div className="absolute inset-0">
              {pageFields.map((field) =>
                renderFieldOverlay(field, field.coordinates)
              )}
            </div>
          </div>
        </Document>
      </div>
    </div>
  );
}
