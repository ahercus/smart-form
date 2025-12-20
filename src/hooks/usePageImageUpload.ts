"use client";

import { useState, useCallback, useRef } from "react";

interface PageImage {
  pageNumber: number;
  imageData: string;
}

interface UsePageImageUploadParams {
  documentId: string;
  totalPages: number;
}

export function usePageImageUpload({
  documentId,
  totalPages,
}: UsePageImageUploadParams) {
  const [uploadedPages, setUploadedPages] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [processingTriggered, setProcessingTriggered] = useState(false);
  const pendingUploads = useRef<PageImage[]>([]);
  const uploadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const capturePageImage = useCallback(
    (pageNumber: number, canvas: HTMLCanvasElement) => {
      // Skip if already uploaded
      if (uploadedPages.has(pageNumber)) {
        return;
      }

      // Convert canvas to base64
      const imageData = canvas.toDataURL("image/png");

      // Add to pending uploads
      pendingUploads.current.push({ pageNumber, imageData });

      console.log("[AutoForm] Page captured:", {
        documentId,
        pageNumber,
        pendingCount: pendingUploads.current.length,
      });

      // Debounce the upload - wait for more pages or 2 seconds
      if (uploadTimeoutRef.current) {
        clearTimeout(uploadTimeoutRef.current);
      }

      uploadTimeoutRef.current = setTimeout(() => {
        uploadPendingPages();
      }, 2000);

      // If we have all pages, upload immediately
      if (
        pendingUploads.current.length + uploadedPages.size >= totalPages &&
        totalPages > 0
      ) {
        if (uploadTimeoutRef.current) {
          clearTimeout(uploadTimeoutRef.current);
        }
        uploadPendingPages();
      }
    },
    [documentId, uploadedPages, totalPages]
  );

  const uploadPendingPages = useCallback(async () => {
    if (pendingUploads.current.length === 0 || uploading) {
      return;
    }

    const pagesToUpload = [...pendingUploads.current];
    pendingUploads.current = [];

    setUploading(true);

    try {
      console.log("[AutoForm] Uploading pages:", {
        documentId,
        count: pagesToUpload.length,
      });

      const response = await fetch(`/api/documents/${documentId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: pagesToUpload }),
      });

      if (!response.ok) {
        throw new Error("Failed to upload pages");
      }

      const result = await response.json();

      // Mark pages as uploaded
      setUploadedPages((prev) => {
        const next = new Set(prev);
        pagesToUpload.forEach((p) => next.add(p.pageNumber));
        return next;
      });

      if (result.processingStarted) {
        setProcessingTriggered(true);
        console.log("[AutoForm] Processing triggered after page upload");
      }
    } catch (error) {
      console.error("[AutoForm] Failed to upload pages:", error);
      // Put failed pages back in the queue
      pendingUploads.current.push(...pagesToUpload);
    } finally {
      setUploading(false);
    }
  }, [documentId, uploading]);

  return {
    capturePageImage,
    uploadedPages: uploadedPages.size,
    uploading,
    processingTriggered,
    allPagesUploaded: totalPages > 0 && uploadedPages.size >= totalPages,
  };
}
