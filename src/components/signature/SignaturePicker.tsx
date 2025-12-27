"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { Plus, Star, Trash2, X } from "lucide-react";
import type { Signature, SignatureType } from "@/lib/types";

interface SignaturePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signatures: Signature[];
  isLoading: boolean;
  onSelect: (signature: Signature) => void;
  onCreateNew: () => void;
  onDelete: (id: string) => Promise<boolean>;
  onSetDefault: (id: string) => Promise<boolean>;
  isMobile?: boolean;
  type?: SignatureType;
}

interface SignatureCardProps {
  signature: Signature;
  onSelect: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

function SignatureCard({
  signature,
  onSelect,
  onDelete,
  onSetDefault,
}: SignatureCardProps) {
  return (
    <Card
      className="relative group cursor-pointer hover:ring-2 hover:ring-primary transition-all overflow-hidden"
      onClick={onSelect}
    >
      {/* Signature preview */}
      <div className="aspect-[2/1] bg-white p-2 flex items-center justify-center">
        {signature.preview_data_url ? (
          <Image
            src={signature.preview_data_url}
            alt={signature.name}
            width={200}
            height={100}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-muted-foreground text-sm">No preview</div>
        )}
      </div>

      {/* Footer with name and actions */}
      <div className="p-2 border-t bg-muted/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{signature.name}</span>
          {signature.is_default && (
            <Badge variant="secondary" className="text-xs shrink-0">
              <Star className="h-3 w-3 mr-0.5 fill-current" />
              Default
            </Badge>
          )}
        </div>

        {/* Action buttons - visible on hover or always on mobile */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!signature.is_default && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onSetDefault();
              }}
              title="Set as default"
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete signature"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SignatureCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[2/1]" />
      <div className="p-2 border-t">
        <Skeleton className="h-4 w-24" />
      </div>
    </Card>
  );
}

export function SignaturePicker({
  open,
  onOpenChange,
  signatures,
  isLoading,
  onSelect,
  onCreateNew,
  onDelete,
  onSetDefault,
  isMobile = false,
  type = "signature",
}: SignaturePickerProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const label = type === "signature" ? "Signature" : "Initials";
  const labelLower = type === "signature" ? "signature" : "initials";

  const handleDelete = async () => {
    if (!deleteConfirmId) return;

    setIsDeleting(true);
    const success = await onDelete(deleteConfirmId);
    setIsDeleting(false);

    if (success) {
      setDeleteConfirmId(null);
    }
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Signature grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <SignatureCardSkeleton />
            <SignatureCardSkeleton />
          </div>
        ) : signatures.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground mb-4">
              No saved {labelLower}s yet
            </p>
            <Button onClick={onCreateNew}>Create Your First {label}</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {signatures.map((signature) => (
              <SignatureCard
                key={signature.id}
                signature={signature}
                onSelect={() => {
                  onSelect(signature);
                  onOpenChange(false);
                }}
                onDelete={() => setDeleteConfirmId(signature.id)}
                onSetDefault={() => onSetDefault(signature.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create new button (when signatures exist) */}
      {!isLoading && signatures.length > 0 && (
        <div className="p-4 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              onCreateNew();
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create New {label}
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {labelLower}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {labelLower} will be permanently deleted. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[70vh]">
          <DrawerHeader className="flex items-center justify-between">
            <DrawerTitle>Select {label}</DrawerTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle>Select {label}</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
