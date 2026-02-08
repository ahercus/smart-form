"use client";

import { useState } from "react";
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
import { ChevronDown, Pencil, Trash2, Brain, User, MapPin, Building2, Plus, AlertTriangle, Loader2 } from "lucide-react";

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

  // Edit fact dialog state
  const [editFactDialogOpen, setEditFactDialogOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<EntityFact | null>(null);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [factValue, setFactValue] = useState("");
  const [factSubmitting, setFactSubmitting] = useState(false);

  // Edit relationship dialog state
  const [editRelationshipDialogOpen, setEditRelationshipDialogOpen] = useState(false);
  const [relationshipEntity, setRelationshipEntity] = useState<Entity | null>(null);
  const [relationshipValue, setRelationshipValue] = useState("");

  // Add fact dialog state
  const [addFactDialogOpen, setAddFactDialogOpen] = useState(false);
  const [addFactEntityId, setAddFactEntityId] = useState("");
  const [newFactType, setNewFactType] = useState("");
  const [newFactValue, setNewFactValue] = useState("");

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);
  const [factToDelete, setFactToDelete] = useState<EntityFact | null>(null);

  function openEditFactDialog(entity: Entity, fact: EntityFact) {
    setEditingEntity(entity);
    setEditingFact(fact);
    setFactValue(fact.fact_value);
    setEditFactDialogOpen(true);
  }

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

  function openAddFactDialog(entityId: string) {
    setAddFactEntityId(entityId);
    setNewFactType("");
    setNewFactValue("");
    setAddFactDialogOpen(true);
  }

  async function handleUpdateFact() {
    if (!editingFact || !factValue.trim()) return;

    setFactSubmitting(true);
    try {
      await updateFact(editingFact.id, { fact_value: factValue.trim() });
      toast.success("Fact updated");
      setEditFactDialogOpen(false);
    } catch {
      toast.error("Failed to update fact");
    } finally {
      setFactSubmitting(false);
    }
  }

  async function handleAddFact() {
    if (!addFactEntityId || !newFactType.trim() || !newFactValue.trim()) return;

    setFactSubmitting(true);
    try {
      // Convert fact type to snake_case
      const factType = newFactType.trim().toLowerCase().replace(/\s+/g, "_");
      await addFact(addFactEntityId, factType, newFactValue.trim());
      toast.success("Fact added");
      setAddFactDialogOpen(false);
    } catch {
      toast.error("Failed to add fact");
    } finally {
      setFactSubmitting(false);
    }
  }

  function confirmDeleteEntity(entity: Entity) {
    setEntityToDelete(entity);
    setFactToDelete(null);
    setDeleteConfirmOpen(true);
  }

  function confirmDeleteFact(fact: EntityFact) {
    setFactToDelete(fact);
    setEntityToDelete(null);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    try {
      if (entityToDelete) {
        await deleteEntity(entityToDelete.id);
        toast.success("Entity deleted");
      } else if (factToDelete) {
        await deleteFact(factToDelete.id);
        toast.success("Fact deleted");
      }
      setDeleteConfirmOpen(false);
      setEntityToDelete(null);
      setFactToDelete(null);
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

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl space-y-6">
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
                    onEditFact={openEditFactDialog}
                    onEditRelationship={openEditRelationshipDialog}
                    onDeleteFact={confirmDeleteFact}
                    onDeleteEntity={confirmDeleteEntity}
                    onAddFact={openAddFactDialog}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Fact Dialog */}
      <Dialog open={editFactDialogOpen} onOpenChange={setEditFactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Fact</DialogTitle>
            <DialogDescription>
              Update the value for {editingFact && formatFactType(editingFact.fact_type)}
              {editingEntity && ` (${editingEntity.canonical_name})`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="factValue">Value</Label>
              <Input
                id="factValue"
                value={factValue}
                onChange={(e) => setFactValue(e.target.value)}
                placeholder="Enter value..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFactDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateFact}
              disabled={!factValue.trim() || factSubmitting}
            >
              {factSubmitting ? "Saving..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Fact Dialog */}
      <Dialog open={addFactDialogOpen} onOpenChange={setAddFactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Fact</DialogTitle>
            <DialogDescription>
              Add a new fact to this entity
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="factType">Fact Type</Label>
              <Input
                id="factType"
                value={newFactType}
                onChange={(e) => setNewFactType(e.target.value)}
                placeholder="e.g., Phone, Email, Birthdate..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newFactValue">Value</Label>
              <Input
                id="newFactValue"
                value={newFactValue}
                onChange={(e) => setNewFactValue(e.target.value)}
                placeholder="Enter value..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFactDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddFact}
              disabled={!newFactType.trim() || !newFactValue.trim() || factSubmitting}
            >
              {factSubmitting ? "Adding..." : "Add Fact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {entityToDelete ? "Delete Entity" : "Delete Fact"}
            </DialogTitle>
            <DialogDescription>
              {entityToDelete
                ? "This will delete the entity and all its facts. This action cannot be undone."
                : "Are you sure you want to delete this fact? This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {entityToDelete && (
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">{entityToDelete.canonical_name}</p>
                <p className="text-sm text-muted-foreground">
                  {entityToDelete.facts.length} facts will be deleted
                </p>
              </div>
            )}
            {factToDelete && (
              <div className="bg-muted p-3 rounded-md">
                <p className="text-sm">
                  <span className="font-medium">{formatFactType(factToDelete.fact_type)}:</span>{" "}
                  {factToDelete.fact_value}
                </p>
              </div>
            )}
          </div>
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
  onEditFact,
  onEditRelationship,
  onDeleteFact,
  onDeleteEntity,
  onAddFact,
}: {
  type: string;
  entities: Entity[];
  recentlyUpdatedIds: Set<string>;
  onEditFact: (entity: Entity, fact: EntityFact) => void;
  onEditRelationship: (entity: Entity) => void;
  onDeleteFact: (fact: EntityFact) => void;
  onDeleteEntity: (entity: Entity) => void;
  onAddFact: (entityId: string) => void;
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
            onEditFact={onEditFact}
            onEditRelationship={onEditRelationship}
            onDeleteFact={onDeleteFact}
            onDeleteEntity={onDeleteEntity}
            onAddFact={onAddFact}
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

function EntityCard({
  entity,
  isRecentlyUpdated,
  onEditFact,
  onEditRelationship,
  onDeleteFact,
  onDeleteEntity,
  onAddFact,
}: {
  entity: Entity;
  isRecentlyUpdated?: boolean;
  onEditFact: (entity: Entity, fact: EntityFact) => void;
  onEditRelationship: (entity: Entity) => void;
  onDeleteFact: (fact: EntityFact) => void;
  onDeleteEntity: (entity: Entity) => void;
  onAddFact: (entityId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
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

  return (
    <div
      className={`border rounded-lg p-3 ml-6 transition-all ${
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
          <div className="flex items-center gap-2">
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
        <div className="mt-3 space-y-1">
          {visibleFacts.map((fact) => (
            <div
              key={fact.id}
              className="group flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm text-muted-foreground">
                  {formatFactType(fact.fact_type)}:
                </span>{" "}
                <span className="text-sm font-medium">{fact.fact_value}</span>
                {fact.has_conflict && (
                  <AlertTriangle className="inline h-3.5 w-3.5 text-destructive ml-1" />
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onEditFact(entity, fact)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => onDeleteFact(fact)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground mt-2"
            onClick={() => onAddFact(entity.id)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add fact
          </Button>
        </div>
      )}
    </div>
  );
}
