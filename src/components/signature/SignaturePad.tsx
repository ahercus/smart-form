"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Eraser, Undo2, X } from "lucide-react";

interface Point {
  x: number;
  y: number;
  pressure?: number;
}

interface SignaturePadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (dataUrl: string, blob: Blob, name: string, saveForLater: boolean) => void;
  defaultSaveForLater?: boolean;
  isMobile?: boolean;
}

export function SignaturePad({
  open,
  onOpenChange,
  onSave,
  defaultSaveForLater = true,
  isMobile = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saveForLater, setSaveForLater] = useState(defaultSaveForLater);
  const [signatureName, setSignatureName] = useState("My Signature");
  const [history, setHistory] = useState<ImageData[]>([]);
  const lastPoint = useRef<Point | null>(null);

  // Initialize canvas with high DPI support
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set actual size in memory (scaled for retina)
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Set display size
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale context for retina
    ctx.scale(dpr, dpr);

    // Configure drawing style
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    contextRef.current = ctx;

    // Save initial blank state
    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
  }, []);

  useEffect(() => {
    if (open) {
      // Small delay to ensure dialog is rendered
      const timer = setTimeout(initCanvas, 100);
      return () => clearTimeout(timer);
    }
  }, [open, initCanvas]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setHasDrawn(false);
      setSaveForLater(defaultSaveForLater);
      setSignatureName("My Signature");
      setHistory([]);
    }
  }, [open, defaultSaveForLater]);

  const getCoordinates = (
    e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent
  ): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX: number;
    let clientY: number;
    let pressure = 0.5;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      const touch = e.touches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
      // Check for pressure support
      if ("force" in touch) {
        pressure = (touch as Touch & { force: number }).force || 0.5;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      pressure,
    };
  };

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev, imageData]);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCoordinates(e);
    if (!point) return;

    saveToHistory();
    setIsDrawing(true);
    setHasDrawn(true);
    lastPoint.current = point;

    const ctx = contextRef.current;
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();

    const point = getCoordinates(e);
    if (!point || !lastPoint.current) return;

    const ctx = contextRef.current;
    if (!ctx) return;

    // Use quadratic bezier for smooth curves
    const midX = (lastPoint.current.x + point.x) / 2;
    const midY = (lastPoint.current.y + point.y) / 2;

    // Adjust line width based on pressure if available
    const baseWidth = 2;
    const pressureWidth = point.pressure ? baseWidth * (0.5 + point.pressure) : baseWidth;
    ctx.lineWidth = pressureWidth;

    ctx.quadraticCurveTo(lastPoint.current.x, lastPoint.current.y, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);

    lastPoint.current = point;
  };

  const stopDrawing = () => {
    if (isDrawing) {
      const ctx = contextRef.current;
      if (ctx) {
        ctx.stroke();
      }
    }
    setIsDrawing(false);
    lastPoint.current = null;
  };

  const handleUndo = () => {
    if (history.length <= 1) return;

    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    const newHistory = [...history];
    newHistory.pop(); // Remove current state
    const previousState = newHistory[newHistory.length - 1];

    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
      setHistory(newHistory);

      // Check if we're back to blank
      if (newHistory.length === 1) {
        setHasDrawn(false);
      }
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasDrawn(false);

    // Reset history to initial blank state
    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    // Create a new canvas with white background for the saved image
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;

    // Fill with white background
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw the signature
    exportCtx.drawImage(canvas, 0, 0);

    // Convert to PNG blob
    const dataUrl = exportCanvas.toDataURL("image/png");

    exportCanvas.toBlob((blob) => {
      if (blob) {
        onSave(dataUrl, blob, signatureName, saveForLater);
        onOpenChange(false);
      }
    }, "image/png");
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Canvas container */}
      <div className="flex-1 min-h-0 p-4">
        <div className="relative w-full h-full border-2 border-dashed border-muted-foreground/30 rounded-lg bg-white">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            onTouchCancel={stopDrawing}
          />
          {!hasDrawn && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-muted-foreground text-sm">
                Draw your signature here
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="px-4 pb-2 space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="save-for-later"
            checked={saveForLater}
            onCheckedChange={(checked) => setSaveForLater(checked === true)}
          />
          <Label htmlFor="save-for-later" className="text-sm cursor-pointer">
            Save for future forms
          </Label>
        </div>

        {saveForLater && (
          <div className="space-y-1">
            <Label htmlFor="signature-name" className="text-sm">
              Name
            </Label>
            <Input
              id="signature-name"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="My Signature"
              className="h-9"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 p-4 border-t">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={history.length <= 1}
          >
            <Undo2 className="h-4 w-4 mr-1" />
            Undo
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Eraser className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
        <Button onClick={handleSave} disabled={!hasDrawn}>
          Use This Signature
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85vh]">
          <DrawerHeader className="flex items-center justify-between">
            <DrawerTitle>Draw Your Signature</DrawerTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle>Draw Your Signature</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
