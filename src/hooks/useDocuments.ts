"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Document } from "@/lib/types";

interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<Document[]>;
  uploadDocument: (file: File, contextNotes: string) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;
  updateDocumentMemory: (id: string, useMemory: boolean) => Promise<void>;
  renameDocument: (id: string, newName: string) => Promise<void>;
}

const PROCESSING_STATUSES = ["uploading", "analyzing", "extracting", "refining"];
const POLL_INTERVAL = 2000; // 2 seconds

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) {
        throw new Error("Failed to fetch documents");
      }
      const data = await res.json();
      setDocuments(data.documents);
      setError(null);
      return data.documents as Document[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch documents");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while any documents are processing
  useEffect(() => {
    const hasProcessingDocs = documents.some((doc) =>
      PROCESSING_STATUSES.includes(doc.status)
    );

    if (hasProcessingDocs) {
      pollTimeoutRef.current = setTimeout(async () => {
        await fetchDocuments();
      }, POLL_INTERVAL);
    }

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [documents, fetchDocuments]);

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

  const updateDocumentMemory = useCallback(
    async (id: string, useMemory: boolean): Promise<void> => {
      // Optimistic update
      const previousDocuments = documents;
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, use_memory: useMemory } : d))
      );

      try {
        const res = await fetch(`/api/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_memory: useMemory }),
        });

        if (!res.ok) {
          // Revert on failure
          setDocuments(previousDocuments);
          throw new Error("Failed to update document memory setting");
        }
      } catch (err) {
        // Revert on error
        setDocuments(previousDocuments);
        throw err;
      }
    },
    [documents]
  );

  const renameDocument = useCallback(
    async (id: string, newName: string): Promise<void> => {
      const previousDocuments = documents;
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, original_filename: newName } : d
        )
      );

      try {
        const res = await fetch(`/api/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ original_filename: newName }),
        });

        if (!res.ok) {
          setDocuments(previousDocuments);
          throw new Error("Failed to rename document");
        }
      } catch (err) {
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
    updateDocumentMemory,
    renameDocument,
  };
}
