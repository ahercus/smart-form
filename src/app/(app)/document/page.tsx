"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SetupCard } from "@/components/document/SetupCard";
import { AppHeader } from "@/components/layout";
import { toast } from "sonner";

export default function NewDocumentPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = useCallback(
    async (file: File) => {
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
        router.push(`/document/${documentId}`);
      } catch (error) {
        console.error("[AutoForm] Upload failed:", error);
        toast.error(error instanceof Error ? error.message : "Upload failed");
        setUploading(false);
      }
    },
    [router]
  );

  return (
    <>
      <AppHeader>
        <h1 className="font-semibold">New Document</h1>
      </AppHeader>

      <div className="flex-1 flex items-center justify-center p-4">
        <SetupCard
          state="upload"
          onFileSelect={handleFileSelect}
          onContextSubmit={() => {}}
          onContextSkip={() => {}}
          uploading={uploading}
        />
      </div>
    </>
  );
}
