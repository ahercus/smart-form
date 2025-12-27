"use client";

import { useState, useEffect, useCallback } from "react";
import type { Document } from "@/lib/types";

interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  uploadDocument: (file: File, contextNotes: string) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;
}

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) {
        throw new Error("Failed to fetch documents");
      }
      const data = await res.json();
      setDocuments(data.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadDocument = useCallback(
    async (file: File, contextNotes: string): Promise<string> => {
      const formData = new FormData();
      formData.append("file", file);
      if (contextNotes) {
        formData.append("contextNotes", contextNotes);
      }

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();

      // Refresh document list
      await fetchDocuments();

      return data.document_id;
    },
    [fetchDocuments]
  );

  const deleteDocument = useCallback(
    async (id: string): Promise<void> => {
      // Optimistic update - remove from UI immediately
      const previousDocuments = documents;
      setDocuments((prev) => prev.filter((d) => d.id !== id));

      try {
        const res = await fetch(`/api/documents/${id}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          // Revert on failure
          setDocuments(previousDocuments);
          throw new Error("Failed to delete document");
        }
      } catch (err) {
        // Revert on error
        setDocuments(previousDocuments);
        throw err;
      }
    },
    [documents]
  );

  return {
    documents,
    loading,
    error,
    refresh: fetchDocuments,
    uploadDocument,
    deleteDocument,
  };
}
