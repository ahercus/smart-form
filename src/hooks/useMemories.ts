"use client";

import { useState, useEffect, useCallback } from "react";

export interface Memory {
  id: string;
  bundle_id: string;
  content: string;
  source_document_id: string | null;
  source_question: string | null;
  created_at: string;
}

export interface MemoryBundle {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_default: boolean;
  memories: Memory[];
}

export function useMemories() {
  const [bundles, setBundles] = useState<MemoryBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    try {
      const response = await fetch("/api/memories");
      if (!response.ok) {
        throw new Error("Failed to fetch memories");
      }
      const data = await response.json();
      setBundles(data.bundles);
      setError(null);
    } catch (err) {
      console.error("[AutoForm] Failed to fetch memories:", err);
      setError("Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const addMemory = useCallback(
    async (bundleId: string, content: string, source?: { documentId?: string; question?: string }) => {
      try {
        const response = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bundleId,
            content,
            sourceDocumentId: source?.documentId,
            sourceQuestion: source?.question,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to create memory");
        }

        const { memory } = await response.json();

        // Update local state
        setBundles((prev) =>
          prev.map((bundle) =>
            bundle.id === bundleId
              ? { ...bundle, memories: [memory, ...bundle.memories] }
              : bundle
          )
        );

        return memory;
      } catch (err) {
        console.error("[AutoForm] Failed to create memory:", err);
        throw err;
      }
    },
    []
  );

  const updateMemory = useCallback(
    async (memoryId: string, updates: { content?: string; bundleId?: string }) => {
      try {
        const response = await fetch(`/api/memories/${memoryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error("Failed to update memory");
        }

        const { memory } = await response.json();

        // Update local state
        if (updates.bundleId) {
          // Moving to different bundle
          setBundles((prev) =>
            prev.map((bundle) => {
              if (bundle.id === updates.bundleId) {
                return { ...bundle, memories: [memory, ...bundle.memories.filter((m) => m.id !== memoryId)] };
              }
              return { ...bundle, memories: bundle.memories.filter((m) => m.id !== memoryId) };
            })
          );
        } else {
          // Updating in place
          setBundles((prev) =>
            prev.map((bundle) => ({
              ...bundle,
              memories: bundle.memories.map((m) => (m.id === memoryId ? memory : m)),
            }))
          );
        }

        return memory;
      } catch (err) {
        console.error("[AutoForm] Failed to update memory:", err);
        throw err;
      }
    },
    []
  );

  const deleteMemory = useCallback(async (memoryId: string) => {
    try {
      const response = await fetch(`/api/memories/${memoryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete memory");
      }

      // Update local state
      setBundles((prev) =>
        prev.map((bundle) => ({
          ...bundle,
          memories: bundle.memories.filter((m) => m.id !== memoryId),
        }))
      );
    } catch (err) {
      console.error("[AutoForm] Failed to delete memory:", err);
      throw err;
    }
  }, []);

  const totalMemories = bundles.reduce((sum, b) => sum + b.memories.length, 0);

  return {
    bundles,
    loading,
    error,
    addMemory,
    updateMemory,
    deleteMemory,
    refetch: fetchMemories,
    totalMemories,
  };
}
