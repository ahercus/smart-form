"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DocumentCard } from "@/components/DocumentCard";
import { useDocuments } from "@/hooks/useDocuments";
import { AppHeader } from "@/components/layout";

export default function DashboardPage() {
  const router = useRouter();
  const { documents, loading, error, refresh, deleteDocument } = useDocuments();

  const handleUploadClick = () => {
    router.push("/document");
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
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between">
          <h1 className="text-lg font-semibold">Documents</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleUploadClick}>
              <Plus className="h-4 w-4 mr-2" />
              New Document
            </Button>
          </div>
        </div>
      </AppHeader>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-6">
          <p className="text-muted-foreground">
            Upload and manage your documents
          </p>

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
                  Upload your first document to get started. We&apos;ll analyze
                  it and help you fill it out with AI-powered suggestions.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
