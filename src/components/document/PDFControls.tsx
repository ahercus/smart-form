"use client";

import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  VectorSquare,
  Copy,
  Plus,
  Trash2,
  PenTool,
  Eye,
  EyeOff,
} from "lucide-react";

interface PDFControlsProps {
  currentPage: number;
  numPages: number;
  scale: number;
  layoutMode: boolean;
  activeFieldId: string | null;
  hideFieldColors: boolean;
  isMobile?: boolean;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onLayoutModeChange: (enabled: boolean) => void;
  onToggleFieldColors: () => void;
  onAddField: () => void;
  onCopyField: () => void;
  onDeleteField: () => void;
  onOpenSignatureManager?: () => void;
}

export function PDFControls({
  currentPage,
  numPages,
  scale,
  layoutMode,
  activeFieldId,
  hideFieldColors,
  isMobile,
  onPageChange,
  onScaleChange,
  onLayoutModeChange,
  onToggleFieldColors,
  onAddField,
  onCopyField,
  onDeleteField,
  onOpenSignatureManager,
}: PDFControlsProps) {
  return (
    <div className="flex items-center justify-between p-2 border-b bg-muted/50 flex-shrink-0">
      {/* Left: Page navigation */}
      <div className="flex items-center gap-1 sm:gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm min-w-[50px] sm:min-w-[80px] text-center">
          {isMobile ? `${currentPage}/${numPages || "..."}` : `Page ${currentPage} of ${numPages || "..."}`}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          onClick={() => onPageChange(Math.min(numPages, currentPage + 1))}
          disabled={currentPage >= numPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Center: Edit tools */}
      <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
        <Button
          variant={layoutMode ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onLayoutModeChange(!layoutMode)}
          title={layoutMode ? "Exit layout mode" : "Edit layout - move and resize fields"}
        >
          <VectorSquare className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onAddField}
          title="Add new field"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onCopyField}
          disabled={!activeFieldId}
          title="Copy selected field"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDeleteField}
          disabled={!activeFieldId}
          title="Delete selected field (Delete key)"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        {onOpenSignatureManager && (
          <>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onOpenSignatureManager}
              title="Manage signatures & initials"
            >
              <PenTool className="h-4 w-4" />
            </Button>
          </>
        )}
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant={hideFieldColors ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={onToggleFieldColors}
          title={hideFieldColors ? "Show field highlights" : "Hide field highlights"}
        >
          {hideFieldColors ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {/* Right: Zoom controls */}
      <div className="flex items-center gap-1 sm:gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        {!isMobile && (
          <span className="text-sm min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9"
          onClick={() => onScaleChange(Math.min(2, scale + 0.25))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
