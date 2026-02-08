"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Trash2, Loader2, CheckCircle, XCircle, MoreVertical, Brain, Pencil } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Document, DocumentStatus } from "@/lib/types";

interface DocumentCardProps {
  document: Document;
  onDelete?: (id: string) => void;
  onToggleMemory?: (id: string, useMemory: boolean) => void;
  onRename?: (id: string, newName: string) => void;
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

export function DocumentCard({ document, onDelete, onToggleMemory, onRename }: DocumentCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState(document.original_filename);
  const config = STATUS_CONFIG[document.status];
  const isProcessing = !["ready", "failed"].includes(document.status);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    onDelete?.(document.id);
  };

  const handleRenameClick = () => {
    setRenameValue(document.original_filename);
    setShowRenameDialog(true);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== document.original_filename) {
      onRename?.(document.id, trimmed);
    }
    setShowRenameDialog(false);
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
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          {/* Left: Icon + Content */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1.5 rounded-md bg-muted shrink-0">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{document.original_filename}</p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant={config.variant} className="h-5 text-xs px-1.5">
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
                <span className="hidden sm:inline">
                  {formatDate(document.created_at)}
                  {document.page_count && ` • ${document.page_count}p`}
                </span>
                {document.status === "ready" && document.total_fields !== undefined && document.total_fields > 0 && (
                  <span className="hidden sm:inline">
                    • {document.filled_fields || 0}/{document.total_fields}
                  </span>
                )}
              </div>
              {document.error_message && (
                <p className="text-xs text-destructive mt-0.5 truncate">
                  {document.error_message}
                </p>
              )}
              {isProcessing && (
                <Progress value={config.progress} className="h-1 mt-1.5" />
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {document.status !== "failed" && (
              <Button asChild size="sm" variant={isProcessing ? "outline" : "default"} className="h-8 px-3">
                <Link href={`/document/${document.id}`}>Open</Link>
              </Button>
            )}
            {(onDelete || onToggleMemory || onRename) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onRename && (
                    <DropdownMenuItem onClick={handleRenameClick}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                  )}
                  {onToggleMemory && (
                    <>
                      <DropdownMenuCheckboxItem
                        checked={document.use_memory}
                        onCheckedChange={(checked) =>
                          onToggleMemory(document.id, checked)
                        }
                      >
                        <Brain className="h-4 w-4 mr-2" />
                        Use memories
                      </DropdownMenuCheckboxItem>
                    </>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleDeleteClick}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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

      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>
              Enter a new name for this document.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirmRename();
            }}
          >
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRenameDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!renameValue.trim() || renameValue.trim() === document.original_filename}
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
