"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

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

export function useEntities() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const fetchEntities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch entities
      const { data: entitiesData, error: entitiesError } = await supabase
        .from("entities")
        .select("*")
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
    } catch (err) {
      console.error("[AutoForm] Failed to fetch entities:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch entities");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  const updateEntity = useCallback(
    async (entityId: string, updates: Partial<Entity>) => {
      const { error } = await supabase
        .from("entities")
        .update(updates)
        .eq("id", entityId);

      if (error) throw error;

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const deleteEntity = useCallback(
    async (entityId: string) => {
      // Facts and relationships are deleted via CASCADE
      const { error } = await supabase
        .from("entities")
        .delete()
        .eq("id", entityId);

      if (error) throw error;

      // Refresh data
      await fetchEntities();
    },
    [supabase, fetchEntities]
  );

  const updateFact = useCallback(
    async (factId: string, updates: Partial<EntityFact>) => {
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
    refetch: fetchEntities,
    updateEntity,
    deleteEntity,
    updateFact,
    deleteFact,
    addFact,
  };
}
