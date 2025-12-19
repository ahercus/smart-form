"use client";

import { useState, useEffect, useCallback } from "react";
import type { Document } from "@/lib/types";

interface UseDocumentPollingReturn {
  document: Document | null;
  loading: boolean;
  error: string | null;
}

export function useDocumentPolling(
  documentId: string | null,
  onReady?: (document: Document) => void
): UseDocumentPollingReturn {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocument = useCallback(async () => {
    if (!documentId) return null;

    const res = await fetch(`/api/documents/${documentId}`);
    if (!res.ok) {
      throw new Error("Failed to fetch document");
    }
    return res.json();
  }, [documentId]);

  useEffect(() => {
    if (!documentId) {
      setDocument(null);
      return;
    }

    setLoading(true);
    let isCancelled = false;
    let timeoutId: NodeJS.Timeout;

    const poll = async () => {
      try {
        const doc = await fetchDocument();
        if (isCancelled) return;

        setDocument(doc);
        setError(null);
        setLoading(false);

        // Continue polling if still processing
        if (
          doc.status !== "ready" &&
          doc.status !== "failed"
        ) {
          timeoutId = setTimeout(poll, 1000);
        } else if (doc.status === "ready" && onReady) {
          onReady(doc);
        }
      } catch (err) {
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch");
        setLoading(false);
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [documentId, fetchDocument, onReady]);

  return { document, loading, error };
}
