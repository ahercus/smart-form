"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

interface FullCanvasDropZoneProps {
  onDocumentCreated?: (documentId: string) => void;
}

export function FullCanvasDropZone({ onDocumentCreated }: FullCanvasDropZoneProps) {
  const router = useRouter();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploading) return;

    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, [uploading]);

  const uploadFile = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Please upload a PDF or image file");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Upload failed");
      }

      const { documentId } = await response.json();

      // Navigate to document page immediately
      if (onDocumentCreated) {
        onDocumentCreated(documentId);
      } else {
        router.push(`/document/${documentId}`);
      }
    } catch (error) {
      console.error("[AutoForm] Upload failed:", error);
      toast.error(error instanceof Error ? error.message : "Upload failed");
      setUploading(false);
    }
  }, [onDocumentCreated, router]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (uploading) return;

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      uploadFile(droppedFile);
    }
  }, [uploading, uploadFile]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        uploadFile(selectedFile);
      }
    },
    [uploadFile]
  );

  // Uploading state
  if (uploading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted/30">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Uploading...</h3>
          <p className="text-sm text-muted-foreground">
            Starting AI analysis...
          </p>
        </div>
      </div>
    );
  }

  // Drop zone
  return (
    <div
      className={cn(
        "h-full w-full flex flex-col items-center justify-center transition-colors rounded-lg",
        dragActive
          ? "bg-primary/10 border-2 border-dashed border-primary"
          : "bg-muted/30"
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <div className="text-center max-w-md px-4">
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 transition-colors",
          dragActive ? "bg-primary/20" : "bg-muted"
        )}>
          <Upload className={cn(
            "h-10 w-10 transition-colors",
            dragActive ? "text-primary" : "text-muted-foreground"
          )} />
        </div>

        <h2 className="text-2xl font-semibold mb-2">
          {dragActive ? "Drop your file here" : "Drop a form"}
        </h2>
        <p className="text-muted-foreground mb-6">
          Drag and drop your PDF or image here to start.
          We&apos;ll analyze it with AI and help you fill it out.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />

        {/* Camera input for mobile */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          id="camera-upload"
        />

        <div className="flex flex-col sm:flex-row gap-3">
          <Button asChild variant="outline" size="lg">
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              Browse files
            </label>
          </Button>

          {isMobile && (
            <Button asChild size="lg">
              <label htmlFor="camera-upload" className="cursor-pointer">
                <Camera className="h-4 w-4 mr-2" />
                Take photo
              </label>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
