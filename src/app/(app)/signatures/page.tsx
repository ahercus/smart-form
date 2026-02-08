"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AppHeader } from "@/components/layout";
import type { Signature, SignatureType } from "@/lib/types";

interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export default function SignaturesPage() {
  const {
    signaturesByType,
    isLoading,
    createSignature,
    deleteSignature,
    setDefaultSignature,
  } = useSignatures();

  const [activeTab, setActiveTab] = useState<SignatureType>("signature");
  const [selectedSignature, setSelectedSignature] = useState<Signature | null>(
    null
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signatureName, setSignatureName] = useState("My Signature");
  const [history, setHistory] = useState<ImageData[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastPoint = useRef<Point | null>(null);

  const currentSignatures = signaturesByType(activeTab);

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

  useEffect(() => {
    const timer = setTimeout(initCanvas, 100);
    return () => clearTimeout(timer);
  }, [initCanvas]);

  useEffect(() => {
    setSelectedSignature(null);
    setHasDrawn(false);
    setSignatureName(activeTab === "signature" ? "My Signature" : "My Initials");
    setHistory([]);
    const timer = setTimeout(initCanvas, 50);
    return () => clearTimeout(timer);
  }, [activeTab, initCanvas]);

  useEffect(() => {
    if (selectedSignature && canvasRef.current && contextRef.current) {
      const ctx = contextRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(
        0,
        0,
        canvasRef.current.width / dpr,
        canvasRef.current.height / dpr
      );
      setHasDrawn(false);
    }
  }, [selectedSignature]);

  const getCoordinates = (
    e: React.MouseEvent | React.TouchEvent
  ): Point | null => {
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
    setSelectedSignature(null);
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
    const pressureWidth = point.pressure
      ? baseWidth * (0.5 + point.pressure)
      : baseWidth;
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

    const dataUrl = canvas.toDataURL("image/png");

    canvas.toBlob(async (blob) => {
      if (blob) {
        const result = await createSignature(
          blob,
          signatureName ||
            (activeTab === "signature" ? "Signature" : "Initials"),
          dataUrl,
          activeTab,
          false
        );
        if (result) {
          handleClear();
          setSignatureName(
            activeTab === "signature" ? "My Signature" : "My Initials"
          );
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

  return (
    <>
      <AppHeader>
        <h1 className="text-lg font-semibold">Signatures</h1>
      </AppHeader>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Tabs - always visible */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as SignatureType)}
          className="w-full shrink-0"
        >
          <TabsList className="w-full rounded-none border-b h-11 bg-transparent">
            <TabsTrigger value="signature" className="flex-1">
              <PenLine className="h-4 w-4 mr-1.5" />
              Signatures
            </TabsTrigger>
            <TabsTrigger value="initials" className="flex-1">
              Initials
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Main content */}
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Drawing area - takes priority on mobile */}
          <div className="p-4 space-y-4 shrink-0">
            {selectedSignature ? (
              // Viewing selected signature
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{selectedSignature.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedSignature.is_default ? "Default " : ""}
                      {selectedSignature.type === "signature" ? "Signature" : "Initials"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedSignature(null)}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Create New
                  </Button>
                </div>
                <div className="border-2 border-dashed rounded-lg bg-white p-6 flex items-center justify-center min-h-[120px]">
                  {selectedSignature.preview_data_url && (
                    <Image
                      src={selectedSignature.preview_data_url}
                      alt={selectedSignature.name}
                      width={400}
                      height={120}
                      className="object-contain max-h-full"
                    />
                  )}
                </div>
              </div>
            ) : (
              // Drawing canvas
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">
                    Draw {activeTab === "signature" ? "Signature" : "Initials"}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleUndo}
                      disabled={history.length <= 1}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClear}>
                      <Eraser className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Canvas - large on mobile */}
                <div className="relative border-2 border-dashed border-muted-foreground/30 rounded-lg bg-white aspect-[3/1] md:aspect-[6/1]">
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
                        Draw here
                      </p>
                    </div>
                  )}
                </div>

                {/* Name input and save button */}
                <div className="flex gap-2">
                  <Input
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder={activeTab === "signature" ? "Name" : "Initials name"}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSave}
                    disabled={!hasDrawn || isSaving}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Saved signatures list */}
          <div className="flex-1 border-t bg-muted/30">
            <div className="p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Saved {activeTab === "signature" ? "Signatures" : "Initials"}
              </h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : currentSignatures.length === 0 ? (
                <p className="text-center py-6 text-muted-foreground text-sm">
                  No {activeTab === "signature" ? "signatures" : "initials"} saved yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {currentSignatures.map((sig) => (
                    <div
                      key={sig.id}
                      className={`relative group rounded-lg border bg-card p-2 cursor-pointer transition-all ${
                        selectedSignature?.id === sig.id
                          ? "ring-2 ring-primary border-primary"
                          : "hover:border-primary/50 active:bg-muted"
                      }`}
                      onClick={() => setSelectedSignature(sig)}
                    >
                      <div className="h-14 bg-white rounded flex items-center justify-center overflow-hidden px-2">
                        {sig.preview_data_url ? (
                          <Image
                            src={sig.preview_data_url}
                            alt={sig.name}
                            width={200}
                            height={50}
                            className="object-contain w-full h-full"
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
                      {/* Action buttons - visible on hover/tap */}
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 md:group-hover:opacity-100">
                        {!sig.is_default && (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetDefault(sig);
                            }}
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
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {activeTab}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {activeTab} will be permanently deleted. This action cannot
              be undone.
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
