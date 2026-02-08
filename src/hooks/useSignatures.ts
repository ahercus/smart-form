"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Signature, SignatureType } from "@/lib/types";

interface UseSignaturesReturn {
  signatures: Signature[];
  signaturesByType: (type: SignatureType) => Signature[];
  isLoading: boolean;
  error: string | null;
  createSignature: (
    blob: Blob,
    name: string,
    previewDataUrl: string,
    type: SignatureType,
    setAsDefault?: boolean
  ) => Promise<Signature | null>;
  deleteSignature: (id: string) => Promise<boolean>;
  setDefaultSignature: (id: string, type: SignatureType) => Promise<boolean>;
  refreshSignatures: () => Promise<void>;
}

export function useSignatures(): UseSignaturesReturn {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const fetchSignatures = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setSignatures([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("signatures")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      setSignatures(data || []);
    } catch (err) {
      console.error("[AutoForm] Failed to fetch signatures:", err);
      setError(err instanceof Error ? err.message : "Failed to load signatures");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchSignatures();
  }, [fetchSignatures]);

  // Filter signatures by type
  const signaturesByType = useCallback(
    (type: SignatureType) => signatures.filter((s) => s.type === type),
    [signatures]
  );

  const createSignature = useCallback(
    async (
      blob: Blob,
      name: string,
      previewDataUrl: string,
      type: SignatureType,
      setAsDefault: boolean = false
    ): Promise<Signature | null> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Not authenticated");
        }

        // Generate unique filename
        const filename = `${user.id}/${type}/${crypto.randomUUID()}.png`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("signatures")
          .upload(filename, blob, {
            contentType: "image/png",
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        // Check if this is the first of this type
        const existingOfType = signatures.filter((s) => s.type === type);
        const isFirstOfType = existingOfType.length === 0;

        // If setting as default, first unset any existing default of this type
        if (setAsDefault || isFirstOfType) {
          await supabase
            .from("signatures")
            .update({ is_default: false })
            .eq("user_id", user.id)
            .eq("type", type)
            .eq("is_default", true);
        }

        // Create database record
        const { data, error: insertError } = await supabase
          .from("signatures")
          .insert({
            user_id: user.id,
            name,
            storage_path: filename,
            preview_data_url: previewDataUrl,
            type,
            is_default: setAsDefault || isFirstOfType, // First of type is default
          })
          .select()
          .single();

        if (insertError) {
          // Clean up uploaded file if insert fails
          await supabase.storage.from("signatures").remove([filename]);
          throw insertError;
        }

        // Update local state
        setSignatures((prev) => {
          // If new signature is default, unset others of same type
          if (data.is_default) {
            return [
              data,
              ...prev.map((s) =>
                s.type === type ? { ...s, is_default: false } : s
              ),
            ];
          }
          return [data, ...prev];
        });

        console.log("[AutoForm] Signature created:", { id: data.id, name, type });
        return data;
      } catch (err) {
        console.error("[AutoForm] Failed to create signature:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create signature"
        );
        return null;
      }
    },
    [supabase, signatures]
  );

  const deleteSignature = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Not authenticated");
        }

        const signature = signatures.find((s) => s.id === id);
        if (!signature) {
          throw new Error("Signature not found");
        }

        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from("signatures")
          .remove([signature.storage_path]);

        if (storageError) {
          console.warn("[AutoForm] Failed to delete signature file:", storageError);
          // Continue anyway - file might already be deleted
        }

        // Delete from database - include user_id for security
        const { error: deleteError, count } = await supabase
          .from("signatures")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);

        if (deleteError) {
          throw deleteError;
        }

        if (count === 0) {
          throw new Error("Signature not found or access denied");
        }

        // Update local state
        setSignatures((prev) => prev.filter((s) => s.id !== id));

        console.log("[AutoForm] Signature deleted:", { id });
        return true;
      } catch (err) {
        console.error("[AutoForm] Failed to delete signature:", err);
        setError(
          err instanceof Error ? err.message : "Failed to delete signature"
        );
        return false;
      }
    },
    [supabase, signatures]
  );

  const setDefaultSignature = useCallback(
    async (id: string, type: SignatureType): Promise<boolean> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Not authenticated");
        }

        // Unset current default of this type
        await supabase
          .from("signatures")
          .update({ is_default: false })
          .eq("user_id", user.id)
          .eq("type", type)
          .eq("is_default", true);

        // Set new default - include user_id for security
        const { error: updateError, count } = await supabase
          .from("signatures")
          .update({ is_default: true })
          .eq("id", id)
          .eq("user_id", user.id);

        if (updateError) {
          throw updateError;
        }

        if (count === 0) {
          throw new Error("Signature not found or access denied");
        }

        // Update local state
        setSignatures((prev) =>
          prev.map((s) => ({
            ...s,
            is_default: s.id === id ? true : s.type === type ? false : s.is_default,
          }))
        );

        console.log("[AutoForm] Default signature set:", { id, type });
        return true;
      } catch (err) {
        console.error("[AutoForm] Failed to set default signature:", err);
        setError(
          err instanceof Error ? err.message : "Failed to set default signature"
        );
        return false;
      }
    },
    [supabase]
  );

  const refreshSignatures = useCallback(async () => {
    await fetchSignatures();
  }, [fetchSignatures]);

  return {
    signatures,
    signaturesByType,
    isLoading,
    error,
    createSignature,
    deleteSignature,
    setDefaultSignature,
    refreshSignatures,
  };
}
