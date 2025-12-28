"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout";
import { useMemories, type MemoryBundle, type Memory } from "@/hooks/useMemories";
import { ChevronDown, Plus, Pencil, Trash2, Brain } from "lucide-react";

function getMemoryPlaceholder(categoryName?: string): string {
  switch (categoryName?.toLowerCase()) {
    case "family":
      return "E.g., My son Jack, born March 15, 2017, male";
    case "work":
    case "employment":
      return "E.g., Software engineer at Acme Corp since 2020";
    case "medical":
      return "E.g., Allergic to penicillin, takes daily multivitamin";
    case "education":
      return "E.g., Jack attends Lincoln Elementary, 3rd grade";
    case "address":
      return "E.g., Work address: 123 Business Ave, Suite 400";
    case "personal":
      return "E.g., Prefer to be contacted by email";
    default:
      return "E.g., Information to remember for auto-fill...";
  }
}

export default function MemoryPage() {
  const { bundles, loading, addMemory, updateMemory, deleteMemory, totalMemories } = useMemories();

  // Memory dialog state
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryBundleId, setMemoryBundleId] = useState("");
  const [memorySubmitting, setMemorySubmitting] = useState(false);

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);

  function openAddMemoryDialog(bundleId?: string) {
    setEditingMemory(null);
    setMemoryContent("");
    setMemoryBundleId(bundleId || bundles[0]?.id || "");
    setMemoryDialogOpen(true);
  }

  function openEditMemoryDialog(memory: Memory) {
    setEditingMemory(memory);
    setMemoryContent(memory.content);
    setMemoryBundleId(memory.bundle_id);
    setMemoryDialogOpen(true);
  }

  async function handleMemorySubmit() {
    if (!memoryContent.trim() || !memoryBundleId) return;

    setMemorySubmitting(true);
    try {
      if (editingMemory) {
        await updateMemory(editingMemory.id, {
          content: memoryContent.trim(),
          bundleId: memoryBundleId !== editingMemory.bundle_id ? memoryBundleId : undefined,
        });
        toast.success("Memory updated");
      } else {
        await addMemory(memoryBundleId, memoryContent.trim());
        toast.success("Memory added");
      }
      setMemoryDialogOpen(false);
    } catch {
      toast.error(editingMemory ? "Failed to update memory" : "Failed to add memory");
    } finally {
      setMemorySubmitting(false);
    }
  }

  function confirmDeleteMemory(memory: Memory) {
    setMemoryToDelete(memory);
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteMemory() {
    if (!memoryToDelete) return;

    try {
      await deleteMemory(memoryToDelete.id);
      toast.success("Memory deleted");
      setDeleteConfirmOpen(false);
      setMemoryToDelete(null);
    } catch {
      toast.error("Failed to delete memory");
    }
  }

  return (
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between">
          <h1 className="text-lg font-semibold">Memory</h1>
          <Button onClick={() => openAddMemoryDialog()} disabled={loading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Memory
          </Button>
        </div>
      </AppHeader>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl space-y-6">
          <p className="text-muted-foreground">
            Save information for auto-fill across all your documents
          </p>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Saved Memories</CardTitle>
              </div>
              <CardDescription>
                {totalMemories} {totalMemories === 1 ? "item" : "items"} saved for auto-fill
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                bundles.map((bundle) => (
                  <MemoryBundleSection
                    key={bundle.id}
                    bundle={bundle}
                    onAdd={() => openAddMemoryDialog(bundle.id)}
                    onEdit={openEditMemoryDialog}
                    onDelete={confirmDeleteMemory}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add/Edit Memory Dialog */}
      <Dialog open={memoryDialogOpen} onOpenChange={setMemoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMemory ? "Edit Memory" : "Add Memory"}</DialogTitle>
            <DialogDescription>
              {editingMemory
                ? "Update this memory snippet"
                : "Add information that will help auto-fill forms"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bundle">Category</Label>
              <Select value={memoryBundleId} onValueChange={setMemoryBundleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {bundles.map((bundle) => (
                    <SelectItem key={bundle.id} value={bundle.id}>
                      {bundle.icon} {bundle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Memory</Label>
              <Textarea
                id="content"
                placeholder={getMemoryPlaceholder(bundles.find(b => b.id === memoryBundleId)?.name)}
                value={memoryContent}
                onChange={(e) => setMemoryContent(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMemorySubmit}
              disabled={!memoryContent.trim() || !memoryBundleId || memorySubmitting}
            >
              {memorySubmitting ? "Saving..." : editingMemory ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Memory</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this memory? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {memoryToDelete && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                {memoryToDelete.content}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteMemory}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemoryBundleSection({
  bundle,
  onAdd,
  onEdit,
  onDelete,
}: {
  bundle: MemoryBundle;
  onAdd: () => void;
  onEdit: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
}) {
  const [isOpen, setIsOpen] = useState(bundle.memories.length > 0);
  const hasMemories = bundle.memories.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <span>{bundle.icon}</span>
            <span className="font-medium">{bundle.name}</span>
            {hasMemories && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {bundle.memories.length}
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-1 px-1">
        <div className="space-y-1">
          {bundle.memories.map((memory) => (
            <div
              key={memory.id}
              className="group flex items-start justify-between gap-2 rounded-md p-2 hover:bg-muted/50"
            >
              <p className="text-sm flex-1 break-words">{memory.content}</p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onEdit(memory)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => onDelete(memory)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add to {bundle.name}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
