"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Eraser, Undo2, Plus, Star, Trash2, PenLine } from "lucide-react";
import { useSignatures } from "@/hooks/useSignatures";
import type { Signature, SignatureType } from "@/lib/types";

interface Point {
  x: number;
  y: number;
  pressure?: number;
}

interface SignatureManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, shows an "Insert" button to insert the selected signature */
  onInsert?: (dataUrl: string, type: SignatureType) => void;
  /** Initial tab to show (defaults to "signature") */
  initialTab?: SignatureType;
}

export function SignatureManager({
  open,
  onOpenChange,
  onInsert,
  initialTab = "signature",
}: SignatureManagerProps) {
  const {
    signaturesByType,
    isLoading,
    createSignature,
    deleteSignature,
    setDefaultSignature,
  } = useSignatures();

  const [activeTab, setActiveTab] = useState<SignatureType>(initialTab);
  const [selectedSignature, setSelectedSignature] = useState<Signature | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [history, setHistory] = useState<ImageData[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastPoint = useRef<Point | null>(null);

  const currentSignatures = signaturesByType(activeTab);

  // Initialize canvas
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    contextRef.current = ctx;

    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
  }, []);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setSelectedSignature(null);
      setHasDrawn(false);
      setSignatureName(initialTab === "signature" ? "My Signature" : "My Initials");
      setHistory([]);
      const timer = setTimeout(initCanvas, 100);
      return () => clearTimeout(timer);
    }
  }, [open, initialTab, initCanvas]);

  // Reset canvas when switching tabs
  useEffect(() => {
    if (open) {
      setSelectedSignature(null);
      setHasDrawn(false);
      setSignatureName(activeTab === "signature" ? "My Signature" : "My Initials");
      setHistory([]);
      const timer = setTimeout(initCanvas, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTab, initCanvas, open]);

  // Clear canvas when selecting a signature to view
  useEffect(() => {
    if (selectedSignature && canvasRef.current && contextRef.current) {
      const ctx = contextRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvasRef.current.width / dpr, canvasRef.current.height / dpr);
      setHasDrawn(false);
    }
  }, [selectedSignature]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    let pressure = 0.5;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      const touch = e.touches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
      if ("force" in touch) {
        pressure = (touch as Touch & { force: number }).force || 0.5;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return { x: clientX - rect.left, y: clientY - rect.top, pressure };
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
    setSelectedSignature(null); // Deselect when starting to draw
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

    const midX = (lastPoint.current.x + point.x) / 2;
    const midY = (lastPoint.current.y + point.y) / 2;
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
    if (isDrawing && contextRef.current) {
      contextRef.current.stroke();
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
    newHistory.pop();
    const previousState = newHistory[newHistory.length - 1];

    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
      setHistory(newHistory);
      if (newHistory.length === 1) setHasDrawn(false);
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasDrawn(false);
    setSelectedSignature(null);

    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    setIsSaving(true);

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) {
      setIsSaving(false);
      return;
    }

    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);

    const dataUrl = exportCanvas.toDataURL("image/png");

    exportCanvas.toBlob(async (blob) => {
      if (blob) {
        const result = await createSignature(
          blob,
          signatureName || (activeTab === "signature" ? "Signature" : "Initials"),
          dataUrl,
          activeTab,
          false
        );
        if (result) {
          handleClear();
          setSignatureName(activeTab === "signature" ? "My Signature" : "My Initials");
        }
      }
      setIsSaving(false);
    }, "image/png");
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    const success = await deleteSignature(deleteConfirmId);
    setIsDeleting(false);
    if (success) {
      setDeleteConfirmId(null);
      if (selectedSignature?.id === deleteConfirmId) {
        setSelectedSignature(null);
      }
    }
  };

  const handleSetDefault = async (sig: Signature) => {
    await setDefaultSignature(sig.id, sig.type);
  };

  const handleInsert = () => {
    if (selectedSignature?.preview_data_url && onInsert) {
      onInsert(selectedSignature.preview_data_url, selectedSignature.type);
      onOpenChange(false);
    }
  };

  // Insert from a freshly drawn signature
  const handleInsertDrawn = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn || !onInsert) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;

    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);

    const dataUrl = exportCanvas.toDataURL("image/png");
    onInsert(dataUrl, activeTab);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>Manage Signatures & Initials</DialogTitle>
          </DialogHeader>

          <div className="flex flex-1 min-h-0">
            {/* Left sidebar */}
            <div className="w-64 border-r flex flex-col">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as SignatureType)}
                className="w-full"
              >
                <TabsList className="w-full rounded-none border-b h-11">
                  <TabsTrigger value="signature" className="flex-1">
                    <PenLine className="h-4 w-4 mr-1.5" />
                    Signatures
                  </TabsTrigger>
                  <TabsTrigger value="initials" className="flex-1">
                    Initials
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </>
                  ) : currentSignatures.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No {activeTab === "signature" ? "signatures" : "initials"} saved yet.
                      <br />
                      Draw one on the right to save it.
                    </div>
                  ) : (
                    currentSignatures.map((sig) => (
                      <div
                        key={sig.id}
                        className={`relative group rounded-lg border p-2 cursor-pointer transition-all ${
                          selectedSignature?.id === sig.id
                            ? "ring-2 ring-primary border-primary"
                            : "hover:border-primary/50"
                        }`}
                        onClick={() => setSelectedSignature(sig)}
                      >
                        <div className="aspect-[2/1] bg-white rounded flex items-center justify-center overflow-hidden">
                          {sig.preview_data_url ? (
                            <Image
                              src={sig.preview_data_url}
                              alt={sig.name}
                              width={180}
                              height={90}
                              className="object-contain"
                            />
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              No preview
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs font-medium truncate flex-1">
                            {sig.name}
                          </span>
                          {sig.is_default && (
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 ml-1" />
                          )}
                        </div>
                        {/* Hover actions */}
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                          {!sig.is_default && (
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetDefault(sig);
                              }}
                              title="Set as default"
                            >
                              <Star className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(sig.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right canvas area */}
            <div className="flex-1 flex flex-col p-6">
              {selectedSignature ? (
                // Viewing selected signature
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium">{selectedSignature.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedSignature.is_default ? "Default " : ""}
                        {selectedSignature.type === "signature" ? "Signature" : "Initials"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedSignature(null)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create New
                      </Button>
                      {onInsert && (
                        <Button onClick={handleInsert}>
                          Insert
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 border-2 border-dashed rounded-lg bg-white flex items-center justify-center">
                    {selectedSignature.preview_data_url && (
                      <Image
                        src={selectedSignature.preview_data_url}
                        alt={selectedSignature.name}
                        width={400}
                        height={200}
                        className="object-contain max-h-full"
                      />
                    )}
                  </div>
                </div>
              ) : (
                // Drawing canvas
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium">
                      Draw {activeTab === "signature" ? "Signature" : "Initials"}
                    </h3>
                    <div className="flex items-center gap-2">
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
                  </div>

                  <div className="flex-1 relative border-2 border-dashed border-muted-foreground/30 rounded-lg bg-white min-h-[200px]">
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
                        <p className="text-muted-foreground">
                          Draw your {activeTab === "signature" ? "signature" : "initials"} here
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-end gap-4">
                    <div className="flex-1">
                      <Label htmlFor="sig-name" className="text-sm">
                        Name (for saving to library)
                      </Label>
                      <Input
                        id="sig-name"
                        value={signatureName}
                        onChange={(e) => setSignatureName(e.target.value)}
                        placeholder={activeTab === "signature" ? "My Signature" : "My Initials"}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      {onInsert && (
                        <Button
                          variant="outline"
                          onClick={handleInsertDrawn}
                          disabled={!hasDrawn}
                        >
                          Insert
                        </Button>
                      )}
                      <Button onClick={handleSave} disabled={!hasDrawn || isSaving}>
                        {isSaving ? "Saving..." : "Save to Library"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {activeTab}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {activeTab} will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
