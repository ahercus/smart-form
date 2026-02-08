"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout";
import { useEntities, type Entity, type EntityFact } from "@/hooks/useEntities";
import { getFactPriority, shouldHideFact } from "@/lib/memory/relationships";
import { ChevronDown, Trash2, Brain, User, MapPin, Building2, Plus, AlertTriangle, Loader2, X, Check } from "lucide-react";

// Entity type icons
function getEntityIcon(type: string) {
  switch (type) {
    case "person":
      return <User className="h-4 w-4" />;
    case "place":
      return <MapPin className="h-4 w-4" />;
    case "organization":
      return <Building2 className="h-4 w-4" />;
    default:
      return <Brain className="h-4 w-4" />;
  }
}

// Format fact type for display
function formatFactType(factType: string): string {
  return factType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Format entity type for display
function formatEntityType(entityType: string): string {
  return entityType.charAt(0).toUpperCase() + entityType.slice(1) + "s";
}

export default function MemoryPage() {
  const {
    entitiesByType,
    loading,
    totalEntities,
    totalFacts,
    deleteEntity,
    updateEntity,
    updateFact,
    deleteFact,
    addFact,
    isReconciling,
    recentlyUpdatedIds,
  } = useEntities();

  // Edit relationship dialog state
  const [editRelationshipDialogOpen, setEditRelationshipDialogOpen] = useState(false);
  const [relationshipEntity, setRelationshipEntity] = useState<Entity | null>(null);
  const [relationshipValue, setRelationshipValue] = useState("");
  const [factSubmitting, setFactSubmitting] = useState(false);

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);

  function openEditRelationshipDialog(entity: Entity) {
    setRelationshipEntity(entity);
    setRelationshipValue(entity.relationship_to_user || "");
    setEditRelationshipDialogOpen(true);
  }

  async function handleUpdateRelationship() {
    if (!relationshipEntity) return;

    setFactSubmitting(true);
    try {
      await updateEntity(relationshipEntity.id, {
        relationship_to_user: relationshipValue.trim().toLowerCase() || null,
      });
      toast.success("Relationship updated");
      setEditRelationshipDialogOpen(false);
    } catch {
      toast.error("Failed to update relationship");
    } finally {
      setFactSubmitting(false);
    }
  }

  function confirmDeleteEntity(entity: Entity) {
    setEntityToDelete(entity);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    try {
      if (entityToDelete) {
        await deleteEntity(entityToDelete.id);
        toast.success("Entity deleted");
      }
      setDeleteConfirmOpen(false);
      setEntityToDelete(null);
    } catch {
      toast.error("Failed to delete");
    }
  }

  const entityTypes = Object.keys(entitiesByType).sort((a, b) => {
    // Sort people first, then places, then others
    const order: Record<string, number> = { person: 0, place: 1, organization: 2 };
    return (order[a] ?? 99) - (order[b] ?? 99);
  });

  return (
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between">
          <h1 className="text-lg font-semibold">Memory</h1>
          {isReconciling && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Syncing...</span>
            </div>
          )}
        </div>
      </AppHeader>

      <div className="flex-1 overflow-auto p-2 md:p-6">
        <div className="md:max-w-2xl md:mx-auto space-y-6">
          <p className="text-muted-foreground">
            Information learned from your form completions, organized by entities
          </p>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Known Entities</CardTitle>
              </div>
              <CardDescription>
                {totalEntities} {totalEntities === 1 ? "entity" : "entities"} with {totalFacts} {totalFacts === 1 ? "fact" : "facts"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : entityTypes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No entities yet</p>
                  <p className="text-sm mt-1">
                    Entities will be learned automatically as you fill out forms
                  </p>
                </div>
              ) : (
                entityTypes.map((type) => (
                  <EntityTypeSection
                    key={type}
                    type={type}
                    entities={entitiesByType[type]}
                    recentlyUpdatedIds={recentlyUpdatedIds}
                    onEditRelationship={openEditRelationshipDialog}
                    onDeleteEntity={confirmDeleteEntity}
                    updateFact={updateFact}
                    deleteFact={deleteFact}
                    addFact={addFact}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Entity Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Entity</DialogTitle>
            <DialogDescription>
              This will delete the entity and all its facts. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {entityToDelete && (
            <div className="py-4">
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">{entityToDelete.canonical_name}</p>
                <p className="text-sm text-muted-foreground">
                  {entityToDelete.facts.length} facts will be deleted
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Relationship Dialog */}
      <Dialog open={editRelationshipDialogOpen} onOpenChange={setEditRelationshipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Relationship</DialogTitle>
            <DialogDescription>
              How is {relationshipEntity?.canonical_name} related to you?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="relationship">Relationship</Label>
              <Input
                id="relationship"
                value={relationshipValue}
                onChange={(e) => setRelationshipValue(e.target.value)}
                placeholder="e.g., spouse, son, daughter, mother, friend..."
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to clear the relationship tag
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRelationshipDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRelationship}
              disabled={factSubmitting}
            >
              {factSubmitting ? "Saving..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EntityTypeSection({
  type,
  entities,
  recentlyUpdatedIds,
  onEditRelationship,
  onDeleteEntity,
  updateFact,
  deleteFact,
  addFact,
}: {
  type: string;
  entities: Entity[];
  recentlyUpdatedIds: Set<string>;
  onEditRelationship: (entity: Entity) => void;
  onDeleteEntity: (entity: Entity) => void;
  updateFact: (factId: string, updates: { fact_value: string }) => Promise<void>;
  deleteFact: (factId: string) => Promise<void>;
  addFact: (entityId: string, factType: string, factValue: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            {getEntityIcon(type)}
            <span className="font-medium">{formatEntityType(type)}</span>
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {entities.length}
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-2">
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            isRecentlyUpdated={recentlyUpdatedIds.has(entity.id)}
            onEditRelationship={onEditRelationship}
            onDeleteEntity={onDeleteEntity}
            updateFact={updateFact}
            deleteFact={deleteFact}
            addFact={addFact}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Format relationship for display (Title Case)
function formatRelationship(relationship: string): string {
  return relationship
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Inline fact editor component
function InlineFactEditor({
  fact,
  onSave,
  onDelete,
  onCancel,
  isNew = false,
}: {
  fact?: EntityFact;
  onSave: (factType: string, factValue: string) => Promise<void>;
  onDelete?: () => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const [factType, setFactType] = useState(fact?.fact_type ? formatFactType(fact.fact_type) : "");
  const [factValue, setFactValue] = useState(fact?.fact_value || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount and scroll into view after virtual keyboard appears
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 350);
    }
  }, []);

  const handleSave = async () => {
    if (!factType.trim() || !factValue.trim()) return;
    setSaving(true);
    try {
      await onSave(factType.trim(), factValue.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="bg-muted/50 rounded-lg p-3 space-y-3">
      <div className="space-y-2">
        <Input
          ref={inputRef}
          value={isNew ? factType : formatFactType(fact?.fact_type || "")}
          onChange={(e) => setFactType(e.target.value)}
          placeholder="Fact type (e.g., Phone, Email...)"
          className="h-9 text-sm"
          disabled={!isNew}
        />
        <Input
          value={factValue}
          onChange={(e) => setFactValue(e.target.value)}
          placeholder="Value..."
          className="h-9 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) handleSave();
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={handleSave}
            disabled={saving || !factValue.trim() || (isNew && !factType.trim())}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntityCard({
  entity,
  isRecentlyUpdated,
  onEditRelationship,
  onDeleteEntity,
  updateFact,
  deleteFact,
  addFact,
}: {
  entity: Entity;
  isRecentlyUpdated?: boolean;
  onEditRelationship: (entity: Entity) => void;
  onDeleteEntity: (entity: Entity) => void;
  updateFact: (factId: string, updates: { fact_value: string }) => Promise<void>;
  deleteFact: (factId: string) => Promise<void>;
  addFact: (entityId: string, factType: string, factValue: string) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [isAddingFact, setIsAddingFact] = useState(false);
  const hasConflicts = entity.facts.some((f) => f.has_conflict);

  // Check if entity has a full_name fact (to hide redundant name components)
  const hasFullName = entity.facts.some(
    (f) => f.fact_type.toLowerCase() === "full_name"
  );

  // Filter out redundant facts and sort by priority
  const visibleFacts = entity.facts
    .filter((f) => !shouldHideFact(f.fact_type, hasFullName))
    .sort((a, b) => getFactPriority(a.fact_type) - getFactPriority(b.fact_type));

  // For preview, show top priority visible facts
  const previewFacts = visibleFacts.slice(0, 3);

  const handleSaveFact = async (factId: string, _factType: string, factValue: string) => {
    try {
      await updateFact(factId, { fact_value: factValue });
      toast.success("Fact updated");
      setEditingFactId(null);
    } catch {
      toast.error("Failed to update fact");
    }
  };

  const handleDeleteFact = async (factId: string) => {
    try {
      await deleteFact(factId);
      toast.success("Fact deleted");
      setEditingFactId(null);
    } catch {
      toast.error("Failed to delete fact");
    }
  };

  const handleAddFact = async (factType: string, factValue: string) => {
    try {
      const normalizedType = factType.toLowerCase().replace(/\s+/g, "_");
      await addFact(entity.id, normalizedType, factValue);
      toast.success("Fact added");
      setIsAddingFact(false);
    } catch {
      toast.error("Failed to add fact");
    }
  };

  return (
    <div
      className={`border rounded-lg p-3 ml-2 md:ml-6 transition-all ${
        isRecentlyUpdated
          ? "animate-pulse ring-2 ring-primary/50 bg-primary/5"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="flex-1 text-left"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{entity.canonical_name}</span>
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer hover:bg-secondary/80"
              onClick={(e) => {
                e.stopPropagation();
                onEditRelationship(entity);
              }}
            >
              {entity.relationship_to_user
                ? formatRelationship(entity.relationship_to_user)
                : "Add Tag"}
            </Badge>
            {hasConflicts && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Conflicts
              </Badge>
            )}
          </div>
          {!isExpanded && visibleFacts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {previewFacts.map((f) => f.fact_value).join(" • ")}
              {visibleFacts.length > 3 && ` +${visibleFacts.length - 3} more`}
            </p>
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDeleteEntity(entity)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {visibleFacts.map((fact) => (
            <div key={fact.id}>
              {editingFactId === fact.id ? (
                <InlineFactEditor
                  fact={fact}
                  onSave={(_, value) => handleSaveFact(fact.id, fact.fact_type, value)}
                  onDelete={() => handleDeleteFact(fact.id)}
                  onCancel={() => setEditingFactId(null)}
                />
              ) : (
                <button
                  className="w-full text-left rounded-md p-2 hover:bg-muted/50 active:bg-muted transition-colors"
                  onClick={() => {
                    setEditingFactId(fact.id);
                    setIsAddingFact(false);
                  }}
                >
                  <span className="text-sm text-muted-foreground">
                    {formatFactType(fact.fact_type)}:
                  </span>{" "}
                  <span className="text-sm font-medium">{fact.fact_value}</span>
                  {fact.has_conflict && (
                    <AlertTriangle className="inline h-3.5 w-3.5 text-destructive ml-1" />
                  )}
                </button>
              )}
            </div>
          ))}

          {isAddingFact ? (
            <InlineFactEditor
              isNew
              onSave={handleAddFact}
              onCancel={() => setIsAddingFact(false)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => {
                setIsAddingFact(true);
                setEditingFactId(null);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add fact
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
