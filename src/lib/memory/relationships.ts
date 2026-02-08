// Relationship computation from entity graph
// Computes relationship_to_user labels based on entity_relationships connections

import { createAdminClient } from "@/lib/supabase/admin";

export interface EntityRelationship {
  id: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id: string;
  confidence: number;
}

interface EntityWithGender {
  id: string;
  canonical_name: string;
  relationship_to_user: string | null;
  gender?: string | null;
}

// Predicate to user-facing label mapping
const DIRECT_RELATIONSHIP_LABELS: Record<string, { subject: string; object: string }> = {
  spouse_of: { subject: "spouse", object: "spouse" },
  parent_of: { subject: "parent", object: "child" },
  child_of: { subject: "child", object: "parent" },
  sibling_of: { subject: "sibling", object: "sibling" },
  grandparent_of: { subject: "grandparent", object: "grandchild" },
  grandchild_of: { subject: "grandchild", object: "grandparent" },
  lives_at: { subject: "resident", object: "residence" },
  works_at: { subject: "employee", object: "employer" },
};

// Gender-specific labels
const GENDERED_LABELS: Record<string, { male: string; female: string; neutral: string }> = {
  spouse: { male: "husband", female: "wife", neutral: "spouse" },
  parent: { male: "father", female: "mother", neutral: "parent" },
  child: { male: "son", female: "daughter", neutral: "child" },
  sibling: { male: "brother", female: "sister", neutral: "sibling" },
  grandparent: { male: "grandfather", female: "grandmother", neutral: "grandparent" },
  grandchild: { male: "grandson", female: "granddaughter", neutral: "grandchild" },
  "parent-in-law": { male: "father-in-law", female: "mother-in-law", neutral: "parent-in-law" },
  "sibling-in-law": { male: "brother-in-law", female: "sister-in-law", neutral: "sibling-in-law" },
};

/**
 * Apply gender to a relationship label if known
 */
function applyGender(label: string, gender: string | null | undefined): string {
  const genderMap = GENDERED_LABELS[label];
  if (!genderMap) return label;

  if (gender?.toLowerCase() === "male") return genderMap.male;
  if (gender?.toLowerCase() === "female") return genderMap.female;
  return genderMap.neutral;
}

/**
 * Compute the relationship label from the user's perspective
 * Uses the entity_relationships graph to determine the path to the user (self entity)
 */
export function computeRelationshipToUser(
  entityId: string,
  selfEntityId: string | null,
  relationships: EntityRelationship[],
  entities: EntityWithGender[]
): string | null {
  if (!selfEntityId) return null;
  if (entityId === selfEntityId) return "self";

  const entity = entities.find((e) => e.id === entityId);
  const entityGender = entity?.gender;

  // Find spouse entity
  const spouseRel = relationships.find(
    (r) =>
      (r.subject_entity_id === selfEntityId && r.predicate === "spouse_of") ||
      (r.object_entity_id === selfEntityId && r.predicate === "spouse_of")
  );
  const spouseId = spouseRel
    ? spouseRel.subject_entity_id === selfEntityId
      ? spouseRel.object_entity_id
      : spouseRel.subject_entity_id
    : null;

  // Check direct relationship to self
  for (const rel of relationships) {
    // Entity is subject, self is object
    if (rel.subject_entity_id === entityId && rel.object_entity_id === selfEntityId) {
      const labelInfo = DIRECT_RELATIONSHIP_LABELS[rel.predicate];
      if (labelInfo) {
        return applyGender(labelInfo.subject, entityGender);
      }
    }
    // Self is subject, entity is object
    if (rel.subject_entity_id === selfEntityId && rel.object_entity_id === entityId) {
      const labelInfo = DIRECT_RELATIONSHIP_LABELS[rel.predicate];
      if (labelInfo) {
        return applyGender(labelInfo.object, entityGender);
      }
    }
  }

  // Check in-law relationships (via spouse)
  if (spouseId) {
    // Is entity spouse's parent? → parent-in-law
    const isSpouseParent = relationships.some(
      (r) =>
        r.subject_entity_id === entityId &&
        r.predicate === "parent_of" &&
        r.object_entity_id === spouseId
    );
    if (isSpouseParent) {
      return applyGender("parent-in-law", entityGender);
    }

    // Is entity spouse's sibling? → sibling-in-law
    const isSpouseSibling = relationships.some(
      (r) =>
        (r.subject_entity_id === entityId &&
          r.predicate === "sibling_of" &&
          r.object_entity_id === spouseId) ||
        (r.subject_entity_id === spouseId &&
          r.predicate === "sibling_of" &&
          r.object_entity_id === entityId)
    );
    if (isSpouseSibling) {
      return applyGender("sibling-in-law", entityGender);
    }

    // Is entity spouse's child from another relationship? → stepchild
    const isSpouseChild = relationships.some(
      (r) =>
        r.subject_entity_id === spouseId &&
        r.predicate === "parent_of" &&
        r.object_entity_id === entityId
    );
    const isAlsoMyChild = relationships.some(
      (r) =>
        r.subject_entity_id === selfEntityId &&
        r.predicate === "parent_of" &&
        r.object_entity_id === entityId
    );
    if (isSpouseChild && !isAlsoMyChild) {
      return applyGender("child", entityGender); // stepchild, but we just call them child
    }
  }

  // Check if entity is my child's child (grandchild)
  const myChildren = relationships
    .filter(
      (r) => r.subject_entity_id === selfEntityId && r.predicate === "parent_of"
    )
    .map((r) => r.object_entity_id);

  const isGrandchild = relationships.some(
    (r) =>
      myChildren.includes(r.subject_entity_id) &&
      r.predicate === "parent_of" &&
      r.object_entity_id === entityId
  );
  if (isGrandchild) {
    return applyGender("grandchild", entityGender);
  }

  // Check if entity is my parent's parent (grandparent)
  const myParents = relationships
    .filter(
      (r) => r.subject_entity_id === entityId && r.predicate === "parent_of" && r.object_entity_id === selfEntityId
    )
    .map((r) => r.subject_entity_id);

  // Actually check: is someone a parent of one of my parents?
  const myParentIds = relationships
    .filter(
      (r) => r.object_entity_id === selfEntityId && r.predicate === "child_of"
    )
    .map((r) => r.subject_entity_id)
    .concat(
      relationships
        .filter(
          (r) => r.subject_entity_id === selfEntityId && r.predicate === "child_of"
        )
        .map((r) => r.object_entity_id)
    );

  // Fall back to checking if entity is someone's parent who is my parent
  for (const parentId of myParentIds) {
    const isParentOfMyParent = relationships.some(
      (r) =>
        r.subject_entity_id === entityId &&
        r.predicate === "parent_of" &&
        r.object_entity_id === parentId
    );
    if (isParentOfMyParent) {
      return applyGender("grandparent", entityGender);
    }
  }

  return null;
}

/**
 * Recompute relationship_to_user for all entities of a user
 * Should be called after entity_relationships change
 */
export async function recomputeAllRelationships(userId: string): Promise<number> {
  const supabase = createAdminClient();
  let updated = 0;

  // Get self entity
  const { data: selfEntity } = await supabase
    .from("entities")
    .select("id")
    .eq("user_id", userId)
    .eq("relationship_to_user", "self")
    .single();

  const selfEntityId = selfEntity?.id || null;

  // Get all entities with gender facts
  const { data: entities } = await supabase
    .from("entities")
    .select("id, canonical_name, relationship_to_user")
    .eq("user_id", userId);

  if (!entities || entities.length === 0) return 0;

  // Get gender facts for all entities
  const entityIds = entities.map((e) => e.id);
  const { data: genderFacts } = await supabase
    .from("entity_facts")
    .select("entity_id, fact_value")
    .in("entity_id", entityIds)
    .eq("fact_type", "gender");

  const genderMap = new Map<string, string>();
  for (const fact of genderFacts || []) {
    genderMap.set(fact.entity_id, fact.fact_value);
  }

  const entitiesWithGender: EntityWithGender[] = entities.map((e) => ({
    ...e,
    gender: genderMap.get(e.id) || null,
  }));

  // Get all relationships
  const { data: relationships } = await supabase
    .from("entity_relationships")
    .select("*")
    .or(`subject_entity_id.in.(${entityIds.join(",")}),object_entity_id.in.(${entityIds.join(",")})`);

  if (!relationships) return 0;

  // Compute and update each entity's relationship
  for (const entity of entitiesWithGender) {
    const computedRelationship = computeRelationshipToUser(
      entity.id,
      selfEntityId,
      relationships,
      entitiesWithGender
    );

    // Only update if changed
    if (computedRelationship !== entity.relationship_to_user) {
      await supabase
        .from("entities")
        .update({
          relationship_to_user: computedRelationship,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entity.id);

      console.log("[AutoForm] Updated relationship:", {
        entity: entity.canonical_name,
        from: entity.relationship_to_user,
        to: computedRelationship,
      });
      updated++;
    }
  }

  return updated;
}

// Fact types that are redundant when canonical_name or full_name exists
export const REDUNDANT_FACT_TYPES = new Set([
  "first_name",
  "last_name",
  "middle_name",
  "name",
]);

// Fact type display priority (lower = higher priority)
export const FACT_PRIORITY: Record<string, number> = {
  // Identity (shown in canonical_name, so hide these)
  full_name: 100,
  first_name: 101,
  last_name: 102,
  middle_name: 103,

  // High priority - core identity info
  birthdate: 1,
  email: 2,
  phone: 3,

  // Address info
  address: 10,
  full_address: 10,
  street: 11,
  street_address: 11,
  city: 12,
  state: 13,
  zip: 14,

  // Demographics
  gender: 20,
  pronouns: 21,
  race: 22,
  ethnicity: 23,

  // Work/School
  occupation: 30,
  employer: 31,
  school: 32,
  grade: 33,
};

/**
 * Get priority for a fact type (lower = higher priority)
 */
export function getFactPriority(factType: string): number {
  return FACT_PRIORITY[factType.toLowerCase()] ?? 50;
}

/**
 * Check if a fact type should be hidden in the UI
 */
export function shouldHideFact(factType: string, hasFullName: boolean): boolean {
  const normalizedType = factType.toLowerCase();

  // Always hide redundant name components
  if (hasFullName && REDUNDANT_FACT_TYPES.has(normalizedType)) {
    return true;
  }

  // Hide full_name since it's shown as canonical_name
  if (normalizedType === "full_name") {
    return true;
  }

  return false;
}
