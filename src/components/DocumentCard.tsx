"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Trash2, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Document, DocumentStatus } from "@/lib/types";

interface DocumentCardProps {
  document: Document;
  onDelete?: (id: string) => void;
}

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; progress: number }
> = {
  uploading: { label: "Uploading", variant: "secondary", progress: 10 },
  analyzing: { label: "Analyzing", variant: "secondary", progress: 30 },
  extracting: { label: "Extracting fields", variant: "secondary", progress: 60 },
  refining: { label: "Refining", variant: "secondary", progress: 85 },
  ready: { label: "Ready", variant: "default", progress: 100 },
  failed: { label: "Failed", variant: "destructive", progress: 0 },
};

export function DocumentCard({ document, onDelete }: DocumentCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const config = STATUS_CONFIG[document.status];
  const isProcessing = !["ready", "failed"].includes(document.status);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    onDelete?.(document.id);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium truncate">{document.original_filename}</p>
                <Badge variant={config.variant}>
                  {isProcessing && (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  )}
                  {document.status === "ready" && (
                    <CheckCircle className="h-3 w-3 mr-1" />
                  )}
                  {document.status === "failed" && (
                    <XCircle className="h-3 w-3 mr-1" />
                  )}
                  {config.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(document.created_at)}
                {document.page_count && ` • ${document.page_count} page${document.page_count > 1 ? "s" : ""}`}
                {document.status === "ready" && document.total_fields !== undefined && document.total_fields > 0 && (
                  <span>
                    {" • "}
                    {document.filled_fields || 0} of {document.total_fields} fields
                  </span>
                )}
              </p>
              {document.error_message && (
                <p className="text-sm text-destructive mt-1">
                  {document.error_message}
                </p>
              )}
              {isProcessing && (
                <Progress value={config.progress} className="h-1 mt-2" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {document.status !== "failed" && (
              <Button asChild size="sm" variant={isProcessing ? "outline" : "default"}>
                <Link href={`/document/${document.id}`}>Open</Link>
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDeleteClick}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{document.original_filename}&rdquo; will be permanently deleted.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
