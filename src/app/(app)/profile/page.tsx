"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface ProfileData {
  firstName: string;
  middleInitial: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

const defaultProfile: ProfileData = {
  firstName: "",
  middleInitial: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  street: "",
  city: "",
  state: "",
  zip: "",
};

export default function ProfilePage() {
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData>(defaultProfile);
  const { bundles, loading, addMemory, updateMemory, deleteMemory, totalMemories } = useMemories();

  // Load profile data on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch("/api/profile");
        if (response.ok) {
          const data = await response.json();
          if (data.coreData) {
            setProfile({
              firstName: data.coreData.firstName || "",
              middleInitial: data.coreData.middleInitial || "",
              lastName: data.coreData.lastName || "",
              email: data.coreData.email || "",
              phone: data.coreData.phone || "",
              dateOfBirth: data.coreData.dateOfBirth || "",
              street: data.coreData.street || "",
              city: data.coreData.city || "",
              state: data.coreData.state || "",
              zip: data.coreData.zip || "",
            });
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setProfileLoading(false);
      }
    }
    loadProfile();
  }, []);

  function handleChange(field: keyof ProfileData, value: string) {
    setProfile((prev) => ({ ...prev, [field]: value }));
  }

  // Memory dialog state
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryBundleId, setMemoryBundleId] = useState("");
  const [memorySubmitting, setMemorySubmitting] = useState(false);

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coreData: profile }),
      });

      if (!response.ok) {
        throw new Error("Failed to save profile");
      }

      toast.success("Profile saved");
    } catch (error) {
      console.error("Failed to save profile:", error);
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

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
        <h1 className="text-lg font-semibold">Profile</h1>
      </AppHeader>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl space-y-6">
          <p className="text-muted-foreground">
            Manage your information for auto-fill
          </p>

          <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
            {/* Left column - Profile fields */}
            <div className="space-y-6">
              <form onSubmit={handleSave} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Personal Information</CardTitle>
                    <CardDescription>
                      This information will be used to auto-fill forms
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {profileLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 grid-cols-[1fr,auto,1fr]">
                          <div className="space-y-2">
                            <Label htmlFor="firstName">First Name</Label>
                            <Input
                              id="firstName"
                              placeholder="John"
                              value={profile.firstName}
                              onChange={(e) => handleChange("firstName", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2 w-16">
                            <Label htmlFor="middleInitial">M.I.</Label>
                            <Input
                              id="middleInitial"
                              placeholder="A"
                              maxLength={1}
                              className="text-center"
                              value={profile.middleInitial}
                              onChange={(e) => handleChange("middleInitial", e.target.value.toUpperCase())}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="lastName">Last Name</Label>
                            <Input
                              id="lastName"
                              placeholder="Doe"
                              value={profile.lastName}
                              onChange={(e) => handleChange("lastName", e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                              id="email"
                              type="email"
                              placeholder="john@example.com"
                              value={profile.email}
                              onChange={(e) => handleChange("email", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="phone">Phone</Label>
                            <Input
                              id="phone"
                              type="tel"
                              placeholder="(555) 123-4567"
                              value={profile.phone}
                              onChange={(e) => handleChange("phone", e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="dob">Date of Birth</Label>
                          <Input
                            id="dob"
                            type="date"
                            value={profile.dateOfBirth}
                            onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Address</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {profileLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="street">Street Address</Label>
                          <Input
                            id="street"
                            placeholder="123 Main St"
                            value={profile.street}
                            onChange={(e) => handleChange("street", e.target.value)}
                          />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input
                              id="city"
                              placeholder="Nashville"
                              value={profile.city}
                              onChange={(e) => handleChange("city", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="state">State</Label>
                            <Input
                              id="state"
                              placeholder="TN"
                              value={profile.state}
                              onChange={(e) => handleChange("state", e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="zip">ZIP Code</Label>
                            <Input
                              id="zip"
                              placeholder="37201"
                              value={profile.zip}
                              onChange={(e) => handleChange("zip", e.target.value)}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Right column - Memory */}
            <div>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-muted-foreground" />
                      <CardTitle>Memory</CardTitle>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openAddMemoryDialog()}
                      disabled={loading}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  <CardDescription>
                    {totalMemories} {totalMemories === 1 ? "item" : "items"} saved for auto-fill
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
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
                placeholder="E.g., My son Jack is 7 years old, born March 15, 2017"
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
