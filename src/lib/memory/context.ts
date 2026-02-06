// Entity-based memory context for AI prompts
// Replaces the old flat memory bundle system with structured entities

import { createAdminClient } from "../supabase/admin";
import type { Entity, EntityFact, EntityRelationship } from "./types";

interface EntityWithFacts extends Entity {
  facts: EntityFact[];
}

interface FormattedEntity {
  name: string;
  type: string;
  relationship: string | null;
  facts: Record<string, string>;
}

/**
 * Fetch all entities with their facts for a user
 * Orders by confidence and access count for relevance
 */
export async function getUserEntities(userId: string): Promise<EntityWithFacts[]> {
  const supabase = createAdminClient();

  // Get entities ordered by confidence and recency
  const { data: entities, error: entitiesError } = await supabase
    .from("entities")
    .select("*")
    .eq("user_id", userId)
    .gte("confidence", 0.3) // Only include entities with reasonable confidence
    .order("confidence", { ascending: false })
    .order("last_accessed_at", { ascending: false });

  if (entitiesError || !entities) {
    console.error("[AutoForm] Failed to fetch entities:", entitiesError);
    return [];
  }

  if (entities.length === 0) {
    return [];
  }

  // Get facts for all entities
  const entityIds = entities.map((e) => e.id);
  const { data: facts, error: factsError } = await supabase
    .from("entity_facts")
    .select("*")
    .in("entity_id", entityIds)
    .gte("confidence", 0.3);

  if (factsError) {
    console.error("[AutoForm] Failed to fetch entity facts:", factsError);
    return entities.map((e) => ({ ...e, facts: [] }));
  }

  // Attach facts to entities
  return entities.map((entity) => ({
    ...entity,
    facts: (facts || []).filter((f) => f.entity_id === entity.id),
  }));
}

/**
 * Fetch relationships between entities
 * Only returns high-confidence relationships
 */
export async function getEntityRelationships(userId: string): Promise<EntityRelationship[]> {
  const supabase = createAdminClient();

  // Get entities first to find their IDs
  const { data: entities } = await supabase
    .from("entities")
    .select("id")
    .eq("user_id", userId);

  if (!entities || entities.length === 0) {
    return [];
  }

  const entityIds = entities.map((e) => e.id);

  // Get relationships where both entities belong to this user
  const { data: relationships, error } = await supabase
    .from("entity_relationships")
    .select("*")
    .in("subject_entity_id", entityIds)
    .gte("confidence", 0.5); // Only high-confidence relationships

  if (error) {
    console.error("[AutoForm] Failed to fetch relationships:", error);
    return [];
  }

  return relationships || [];
}

/**
 * Format a single entity for display
 */
function formatEntityFacts(entity: EntityWithFacts): string {
  const factsByType: Record<string, string> = {};

  for (const fact of entity.facts) {
    // Skip duplicate fact types, keep highest confidence
    if (!factsByType[fact.fact_type]) {
      factsByType[fact.fact_type] = fact.fact_value;
    }
  }

  const parts: string[] = [];

  // Core identity facts first
  if (factsByType.birthdate) {
    parts.push(`DOB: ${factsByType.birthdate}`);
  }
  if (factsByType.gender) {
    parts.push(`Gender: ${factsByType.gender}`);
  }
  if (factsByType.pronouns) {
    parts.push(`Pronouns: ${factsByType.pronouns}`);
  }
  if (factsByType.ssn) {
    parts.push(`SSN: ${factsByType.ssn}`);
  }
  if (factsByType.race) {
    parts.push(`Race: ${factsByType.race}`);
  }

  // Contact info
  if (factsByType.phone) {
    parts.push(`Phone: ${factsByType.phone}`);
  }
  if (factsByType.email) {
    parts.push(`Email: ${factsByType.email}`);
  }

  // Address (for person entities with inline address)
  if (factsByType.address) {
    parts.push(`Address: ${factsByType.address}`);
  }

  // Place-specific facts
  if (factsByType.full_address) {
    parts.push(factsByType.full_address);
  } else if (factsByType.street || factsByType.city) {
    const addrParts = [
      factsByType.street,
      factsByType.city,
      factsByType.state,
      factsByType.zip,
    ].filter(Boolean);
    if (addrParts.length > 0) {
      parts.push(addrParts.join(", "));
    }
  }

  // Medical/health
  if (factsByType.allergies && factsByType.allergies.toLowerCase() !== "none") {
    parts.push(`Allergies: ${factsByType.allergies}`);
  }

  // Other facts not yet included
  const coveredTypes = new Set([
    "full_name", "first_name", "last_name", "birthdate", "gender", "pronouns",
    "ssn", "race", "phone", "email", "address", "full_address", "street",
    "city", "state", "zip", "allergies",
  ]);

  for (const [factType, factValue] of Object.entries(factsByType)) {
    if (!coveredTypes.has(factType)) {
      // Title case the fact type for display
      const displayType = factType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      parts.push(`${displayType}: ${factValue}`);
    }
  }

  return parts.join("; ");
}

/**
 * Format entities into a prompt-friendly context string
 * Groups by entity type and includes relationship info
 */
export function formatEntitiesForPrompt(
  entities: EntityWithFacts[],
  relationships: EntityRelationship[]
): string {
  if (entities.length === 0) {
    return "";
  }

  // Build a lookup map for entity names
  const entityNameMap = new Map<string, string>();
  for (const e of entities) {
    entityNameMap.set(e.id, e.canonical_name);
  }

  // Group entities by type
  const byType = new Map<string, EntityWithFacts[]>();
  for (const entity of entities) {
    const type = entity.entity_type;
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(entity);
  }

  const sections: string[] = [];

  // People first
  const people = byType.get("person") || [];
  if (people.length > 0) {
    const lines: string[] = [];

    // Self first
    const selfEntity = people.find((p) => p.relationship_to_user === "self");
    if (selfEntity) {
      const facts = formatEntityFacts(selfEntity);
      lines.push(`- **${selfEntity.canonical_name}** (self): ${facts}`);
    }

    // Family members
    const familyOrder = ["spouse", "son", "daughter", "child", "father", "mother", "parent", "grandmother", "grandfather", "grandparent"];
    const family = people
      .filter((p) => p.relationship_to_user && p.relationship_to_user !== "self")
      .sort((a, b) => {
        const aIdx = familyOrder.indexOf(a.relationship_to_user || "");
        const bIdx = familyOrder.indexOf(b.relationship_to_user || "");
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });

    for (const person of family) {
      const facts = formatEntityFacts(person);
      const relationship = person.relationship_to_user || "known person";
      lines.push(`- **${person.canonical_name}** (${relationship}): ${facts}`);
    }

    // Other people without clear relationship
    const others = people.filter((p) => !p.relationship_to_user);
    for (const person of others) {
      const facts = formatEntityFacts(person);
      lines.push(`- **${person.canonical_name}**: ${facts}`);
    }

    sections.push(`### People\n${lines.join("\n")}`);
  }

  // Places
  const places = byType.get("place") || [];
  if (places.length > 0) {
    const lines: string[] = [];
    for (const place of places) {
      const facts = formatEntityFacts(place);
      const relationship = place.relationship_to_user ? ` (${place.relationship_to_user})` : "";
      lines.push(`- **${place.canonical_name}**${relationship}: ${facts}`);
    }
    sections.push(`### Places\n${lines.join("\n")}`);
  }

  // Other entity types
  for (const [type, typeEntities] of byType) {
    if (type === "person" || type === "place") continue;

    const lines: string[] = [];
    for (const entity of typeEntities) {
      const facts = formatEntityFacts(entity);
      const relationship = entity.relationship_to_user ? ` (${entity.relationship_to_user})` : "";
      lines.push(`- **${entity.canonical_name}**${relationship}: ${facts}`);
    }

    // Title case the type
    const displayType = type.charAt(0).toUpperCase() + type.slice(1) + "s";
    sections.push(`### ${displayType}\n${lines.join("\n")}`);
  }

  // Add relationship section if there are interesting ones
  const interestingRelationships = relationships.filter((r) =>
    r.predicate !== "child_of" && r.predicate !== "parent_of" // Skip inverse relationships
  );

  if (interestingRelationships.length > 0 && interestingRelationships.length <= 10) {
    const lines: string[] = [];
    for (const rel of interestingRelationships) {
      const subject = entityNameMap.get(rel.subject_entity_id);
      const object = entityNameMap.get(rel.object_entity_id);
      if (subject && object) {
        const predicate = rel.predicate.replace(/_/g, " ");
        lines.push(`- ${subject} ${predicate} ${object}`);
      }
    }
    if (lines.length > 0) {
      sections.push(`### Relationships\n${lines.join("\n")}`);
    }
  }

  return `## User's Known Information
The following entities and facts have been learned from previous form completions. Use this to auto-fill when relevant.

${sections.join("\n\n")}`;
}

/**
 * Get formatted entity memory context for a user
 * This is the main function to use in prompts - replaces getMemoryContext()
 */
export async function getEntityMemoryContext(userId: string): Promise<string> {
  const [entities, relationships] = await Promise.all([
    getUserEntities(userId),
    getEntityRelationships(userId),
  ]);

  return formatEntitiesForPrompt(entities, relationships);
}

/**
 * Update access tracking when entities are used
 * Call this when memory context is used for auto-fill
 */
export async function trackEntityAccess(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;

  const supabase = createAdminClient();

  try {
    // Update access count and timestamp for accessed entities
    await supabase.rpc("increment_entity_access", { entity_ids: entityIds });
  } catch (error) {
    console.error("[AutoForm] Failed to track entity access:", error);
  }
}
