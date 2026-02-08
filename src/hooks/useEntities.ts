"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface EntityFact {
  id: string;
  entity_id: string;
  fact_type: string;
  fact_value: string;
  confidence: number;
  has_conflict?: boolean;
  created_at: string;
}

export interface Entity {
  id: string;
  entity_type: string;
  canonical_name: string;
  relationship_to_user: string | null;
  confidence: number;
  last_accessed_at: string;
  access_count: number;
  created_at: string;
  facts: EntityFact[];
}

export interface EntityRelationship {
  id: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id: string;
  confidence: number;
}

// How long to show shimmer animation (ms)
const SHIMMER_DURATION = 3000;

export function useEntities() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(new Set());

  const supabase = createClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);

  const fetchEntities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setEntities([]);
        setRelationships([]);
        setLoading(false);
        return;
      }

      userIdRef.current = user.id;

      // Fetch entities for current user only
      const { data: entitiesData, error: entitiesError } = await supabase
        .from("entities")
        .select("*")
        .eq("user_id", user.id)
        .order("entity_type")
        .order("canonical_name");

      if (entitiesError) throw entitiesError;

      if (!entitiesData || entitiesData.length === 0) {
        setEntities([]);
        setRelationships([]);
        setLoading(false);
        return;
      }

      // Fetch facts for all entities
      const entityIds = entitiesData.map((e) => e.id);
      const { data: factsData, error: factsError } = await supabase
        .from("entity_facts")
        .select("*")
        .in("entity_id", entityIds)
        .order("fact_type");

      if (factsError) throw factsError;

      // Attach facts to entities
      const entitiesWithFacts = entitiesData.map((entity) => ({
        ...entity,
        facts: (factsData || []).filter((f) => f.entity_id === entity.id),
      }));

      setEntities(entitiesWithFacts);

      // Fetch relationships
      const { data: relData, error: relError } = await supabase
        .from("entity_relationships")
        .select("*")
        .in("subject_entity_id", entityIds);

      if (relError) throw relError;

      setRelationships(relData || []);

      // Check current reconciliation status
      const { data: statusData } = await supabase
        .from("reconciliation_status")
        .select("is_active")
        .eq("user_id", user.id)
        .single();

      if (statusData) {
        setIsReconciling(statusData.is_active);
      }
    } catch (err) {
      console.error("[AutoForm] Failed to fetch entities:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch entities");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Set up realtime subscriptions
  useEffect(() => {
    fetchEntities();

    // Subscribe to realtime changes
    const channel = supabase
      .channel("memory-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reconciliation_status",
        },
        (payload) => {
          // Only process if it's for the current user
          if (payload.new && typeof payload.new === "object" && "user_id" in payload.new) {
            if (payload.new.user_id === userIdRef.current) {
              setIsReconciling((payload.new as { is_active: boolean }).is_active);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "entities",
        },
        (payload) => {
          // Only process if it's for the current user
          if (payload.new && typeof payload.new === "object" && "user_id" in payload.new) {
            if (payload.new.user_id === userIdRef.current) {
              const entityId = (payload.new as { id: string }).id;

              // Add to recently updated
              setRecentlyUpdatedIds((prev) => new Set(prev).add(entityId));

              // Remove after shimmer duration
              setTimeout(() => {
                setRecentlyUpdatedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(entityId);
                  return next;
                });
              }, SHIMMER_DURATION);

              // Refetch to get updated data
              fetchEntities();
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "entities",
        },
        (payload) => {
          // Only process if it's for the current user
          if (payload.new && typeof payload.new === "object" && "user_id" in payload.new) {
            if (payload.new.user_id === userIdRef.current) {
              const entityId = (payload.new as { id: string }).id;

              // Add to recently updated (new entities also shimmer)
              setRecentlyUpdatedIds((prev) => new Set(prev).add(entityId));

              // Remove after shimmer duration
              setTimeout(() => {
                setRecentlyUpdatedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(entityId);
                  return next;
                });
              }, SHIMMER_DURATION);

              // Refetch to get new entity
              fetchEntities();
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entity_facts",
        },
        (payload) => {
          // For fact changes, find the parent entity and shimmer it
          const entityId =
            (payload.new && typeof payload.new === "object" && "entity_id" in payload.new
              ? (payload.new as { entity_id: string }).entity_id
              : null) ||
            (payload.old && typeof payload.old === "object" && "entity_id" in payload.old
              ? (payload.old as { entity_id: string }).entity_id
              : null);

          if (entityId) {
            // Add to recently updated
            setRecentlyUpdatedIds((prev) => new Set(prev).add(entityId));

            // Remove after shimmer duration
            setTimeout(() => {
              setRecentlyUpdatedIds((prev) => {
                const next = new Set(prev);
                next.delete(entityId);
                return next;
              });
            }, SHIMMER_DURATION);

            // Refetch to get updated facts
            fetchEntities();
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase, fetchEntities]);

  const updateEntity = useCallback(
    async (entityId: string, updates: Partial<Entity>) => {
      if (!userIdRef.current) throw new Error("Not authenticated");

      // Verify ownership by including user_id in the filter
      const { error, count } = await supabase
        .from("entities")
        .update(updates)
        .eq("id", entityId)
        .eq("user_id", userIdRef.current);

      if (error) throw error;
      if (count === 0) throw new Error("Entity not found or access denied");

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const deleteEntity = useCallback(
    async (entityId: string) => {
      if (!userIdRef.current) throw new Error("Not authenticated");

      // Verify ownership by including user_id in the filter
      // Facts and relationships are deleted via CASCADE
      const { error, count } = await supabase
        .from("entities")
        .delete()
        .eq("id", entityId)
        .eq("user_id", userIdRef.current);

      if (error) throw error;
      if (count === 0) throw new Error("Entity not found or access denied");

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const updateFact = useCallback(
    async (factId: string, updates: Partial<EntityFact>) => {
      if (!userIdRef.current) throw new Error("Not authenticated");

      // Verify ownership via entity join
      const { data: fact } = await supabase
        .from("entity_facts")
        .select("entity_id, entities!inner(user_id)")
        .eq("id", factId)
        .single();

      if (!fact || (fact.entities as unknown as { user_id: string }).user_id !== userIdRef.current) {
        throw new Error("Fact not found or access denied");
      }

      const { error } = await supabase
        .from("entity_facts")
        .update(updates)
        .eq("id", factId);

      if (error) throw error;

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const deleteFact = useCallback(
    async (factId: string) => {
      if (!userIdRef.current) throw new Error("Not authenticated");

      // Verify ownership via entity join
      const { data: fact } = await supabase
        .from("entity_facts")
        .select("entity_id, entities!inner(user_id)")
        .eq("id", factId)
        .single();

      if (!fact || (fact.entities as unknown as { user_id: string }).user_id !== userIdRef.current) {
        throw new Error("Fact not found or access denied");
      }

      const { error } = await supabase
        .from("entity_facts")
        .delete()
        .eq("id", factId);

      if (error) throw error;

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const addFact = useCallback(
    async (entityId: string, factType: string, factValue: string) => {
      if (!userIdRef.current) throw new Error("Not authenticated");

      // Verify entity ownership before adding fact
      const { data: entity } = await supabase
        .from("entities")
        .select("id")
        .eq("id", entityId)
        .eq("user_id", userIdRef.current)
        .single();

      if (!entity) {
        throw new Error("Entity not found or access denied");
      }

      const { error } = await supabase.from("entity_facts").insert({
        entity_id: entityId,
        fact_type: factType,
        fact_value: factValue,
        confidence: 0.9, // Manual entries have high confidence
      });

      if (error) throw error;

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  // Group entities by type
  const entitiesByType = entities.reduce(
    (acc, entity) => {
      const type = entity.entity_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(entity);
      return acc;
    },
    {} as Record<string, Entity[]>
  );

  const totalFacts = entities.reduce((sum, e) => sum + e.facts.length, 0);

  return {
    entities,
    entitiesByType,
    relationships,
    loading,
    error,
    totalEntities: entities.length,
    totalFacts,
    isReconciling,
    recentlyUpdatedIds,
    refetch: fetchEntities,
    updateEntity,
    deleteEntity,
    updateFact,
    deleteFact,
    addFact,
  };
}
