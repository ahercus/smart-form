"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { UploadZone } from "@/components/UploadZone";
import { DocumentCard } from "@/components/DocumentCard";
import { useDocuments } from "@/hooks/useDocuments";
import { useDocumentPolling } from "@/hooks/useDocumentPolling";

export default function DashboardPage() {
  const router = useRouter();
  const { documents, loading, error, refresh, uploadDocument, deleteDocument } =
    useDocuments();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);

  // Poll for processing document status
  const { document: processingDoc } = useDocumentPolling(
    processingDocId,
    (doc) => {
      // Document is ready, refresh the list and navigate
      refresh();
      setProcessingDocId(null);
      toast.success("Document processed successfully");
      router.push(`/document/${doc.id}`);
    }
  );

  // Update document in list while processing
  useEffect(() => {
    if (processingDoc) {
      refresh();
    }
  }, [processingDoc?.status, refresh]);

  const handleUpload = async (file: File, contextNotes: string) => {
    try {
      const docId = await uploadDocument(file, contextNotes);
      setUploadDialogOpen(false);
      setProcessingDocId(docId);
      toast.info("Processing document...");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDocument(id);
      toast.success("Document deleted");
    } catch {
      toast.error("Failed to delete document");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Upload and manage your PDF forms
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Upload PDF
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload PDF Form</DialogTitle>
              </DialogHeader>
              <UploadZone onUpload={handleUpload} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No documents yet</CardTitle>
            <CardDescription>
              Upload your first PDF form to get started. We&apos;ll analyze it
              and help you fill it out with AI-powered suggestions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadZone onUpload={handleUpload} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
