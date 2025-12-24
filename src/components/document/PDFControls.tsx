"use client";

import { Button } from "@/components/ui/button";
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
} from "lucide-react";

export type EditMode = "type" | "pointer";

interface PDFControlsProps {
  currentPage: number;
  numPages: number;
  scale: number;
  editMode: EditMode;
  activeFieldId: string | null;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onEditModeChange: (mode: EditMode) => void;
  onAddField: () => void;
  onCopyField: () => void;
  onDeleteField: () => void;
}

export function PDFControls({
  currentPage,
  numPages,
  scale,
  editMode,
  activeFieldId,
  onPageChange,
  onScaleChange,
  onEditModeChange,
  onAddField,
  onCopyField,
  onDeleteField,
}: PDFControlsProps) {
  return (
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
          onClick={() => onEditModeChange("type")}
          title="Type mode - click to edit field values"
        >
          <Type className="h-4 w-4" />
        </Button>
        <Button
          variant={editMode === "pointer" ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onEditModeChange("pointer")}
          title="Pointer mode - move and resize fields"
        >
          <MousePointer2 className="h-4 w-4" />
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
      </div>

      {/* Right: Zoom controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-sm min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onScaleChange(Math.min(2, scale + 0.25))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
