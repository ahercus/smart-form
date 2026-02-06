// Memory reconciliation against profile updates
// When user updates their profile, re-evaluate existing memories for:
// - Relationship adjustments (last name matches → likely biological relation)
// - Fact confidence changes (profile confirms/conflicts with memory)
// - Entity merging (profile matches memory entity)

import { ThinkingLevel } from "@google/genai";
import { generateFast } from "@/lib/gemini/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProfileCoreData } from "@/app/api/profile/route";
import { Entity, EntityFact, CONFIDENCE_ADJUSTMENTS } from "./types";
import { generateEmbedding } from "./embeddings";

// Profile fields are authoritative - use max confidence
const PROFILE_CONFIDENCE = CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE;

// Map profile fields to entity fact types
const PROFILE_TO_FACT_TYPE: Record<keyof ProfileCoreData, string> = {
  firstName: "first_name",
  middleInitial: "middle_initial",
  lastName: "last_name",
  email: "email",
  phone: "phone",
  dateOfBirth: "birthdate",
  street: "street_address",
  city: "city",
  state: "state",
  zip: "zip",
};

interface EntityWithFacts extends Entity {
  facts: EntityFact[];
}

interface ReconciliationAction {
  type: "boost_confidence" | "reduce_confidence" | "update_relationship" | "flag_conflict";
  entityId: string;
  factId?: string;
  details: string;
  newConfidence?: number;
  newRelationship?: string;
}

interface ReconciliationResult {
  entities: Array<{
    name: string;
    relationship: string | null;
    actions: Array<{
      action: "boost_confidence" | "reduce_confidence" | "update_relationship" | "flag_conflict";
      target: "entity" | "fact";
      factType?: string;
      reason: string;
      confidenceChange?: number;
      newRelationship?: string;
    }>;
  }>;
}

/**
 * Sync profile data to the "self" entity
 * Profile is the source of truth - facts get max confidence
 * Returns the number of facts synced
 */
async function syncProfileToSelfEntity(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  profile: ProfileCoreData
): Promise<{ factsSynced: number; selfEntityId: string | null }> {
  let factsSynced = 0;

  // Find the self entity
  const { data: selfEntity } = await supabase
    .from("entities")
    .select("id, canonical_name")
    .eq("user_id", userId)
    .eq("relationship_to_user", "self")
    .single();

  let selfEntityId = selfEntity?.id;

  // Create self entity if it doesn't exist and we have profile data
  if (!selfEntityId) {
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Me";
    const embedding = await generateEmbedding(name);

    const { data: newSelf, error } = await supabase
      .from("entities")
      .insert({
        user_id: userId,
        entity_type: "person",
        canonical_name: name,
        relationship_to_user: "self",
        confidence: PROFILE_CONFIDENCE,
        embedding: embedding.length > 0 ? embedding : null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[AutoForm] Failed to create self entity:", error);
      return { factsSynced: 0, selfEntityId: null };
    }

    selfEntityId = newSelf.id;
    console.log("[AutoForm] Created self entity from profile:", { name, id: selfEntityId });
  } else {
    // Update self entity name if profile has full name
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    if (fullName && selfEntity.canonical_name !== fullName) {
      await supabase
        .from("entities")
        .update({
          canonical_name: fullName,
          confidence: PROFILE_CONFIDENCE,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selfEntityId);

      console.log("[AutoForm] Updated self entity name:", {
        oldName: selfEntity.canonical_name,
        newName: fullName,
      });
    }
  }

  // Sync each profile field to a fact
  for (const [profileKey, factType] of Object.entries(PROFILE_TO_FACT_TYPE)) {
    const value = profile[profileKey as keyof ProfileCoreData];
    if (!value || String(value).trim() === "") continue;

    const factValue = String(value).trim();

    // Check if fact already exists
    const { data: existingFact } = await supabase
      .from("entity_facts")
      .select("id, fact_value, confidence")
      .eq("entity_id", selfEntityId)
      .eq("fact_type", factType)
      .single();

    if (existingFact) {
      if (existingFact.fact_value === factValue) {
        // Same value - just ensure max confidence
        if (existingFact.confidence < PROFILE_CONFIDENCE) {
          await supabase
            .from("entity_facts")
            .update({ confidence: PROFILE_CONFIDENCE })
            .eq("id", existingFact.id);
          factsSynced++;
        }
      } else {
        // Different value - profile wins, update the fact
        await supabase
          .from("entity_facts")
          .update({
            fact_value: factValue,
            confidence: PROFILE_CONFIDENCE,
            has_conflict: false, // Profile resolves conflicts
            conflicting_fact_id: null,
          })
          .eq("id", existingFact.id);

        console.log("[AutoForm] Profile overrode memory fact:", {
          factType,
          oldValue: existingFact.fact_value,
          newValue: factValue,
        });
        factsSynced++;
      }
    } else {
      // Create new fact from profile
      const embedding = await generateEmbedding(`self ${factType}: ${factValue}`);

      await supabase.from("entity_facts").insert({
        entity_id: selfEntityId,
        fact_type: factType,
        fact_value: factValue,
        confidence: PROFILE_CONFIDENCE,
        source_document_id: null,
        source_question: "Profile",
        embedding: embedding.length > 0 ? embedding : null,
        has_conflict: false,
      });

      console.log("[AutoForm] Created fact from profile:", { factType, factValue });
      factsSynced++;
    }
  }

  // Also create/update full_name fact
  const fullName = [profile.firstName, profile.middleInitial, profile.lastName]
    .filter(Boolean)
    .join(" ");

  if (fullName) {
    const { data: existingFullName } = await supabase
      .from("entity_facts")
      .select("id, fact_value")
      .eq("entity_id", selfEntityId)
      .eq("fact_type", "full_name")
      .single();

    if (existingFullName) {
      if (existingFullName.fact_value !== fullName) {
        await supabase
          .from("entity_facts")
          .update({
            fact_value: fullName,
            confidence: PROFILE_CONFIDENCE,
          })
          .eq("id", existingFullName.id);
        factsSynced++;
      }
    } else {
      const embedding = await generateEmbedding(`self full_name: ${fullName}`);
      await supabase.from("entity_facts").insert({
        entity_id: selfEntityId,
        fact_type: "full_name",
        fact_value: fullName,
        confidence: PROFILE_CONFIDENCE,
        source_question: "Profile",
        embedding: embedding.length > 0 ? embedding : null,
        has_conflict: false,
      });
      factsSynced++;
    }
  }

  return { factsSynced, selfEntityId };
}

const reconciliationSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Entity name to apply action to" },
          relationship: { type: "string", description: "Current relationship to user (or null)" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["boost_confidence", "reduce_confidence", "update_relationship", "flag_conflict"],
                  description: "Action to take",
                },
                target: {
                  type: "string",
                  enum: ["entity", "fact"],
                  description: "Whether action applies to entity or a specific fact",
                },
                factType: {
                  type: "string",
                  description: "If target is fact, which fact type (e.g., last_name, birthdate)",
                },
                reason: { type: "string", description: "Why this action is recommended" },
                confidenceChange: {
                  type: "number",
                  description: "For confidence actions, the delta (-0.2 to +0.2)",
                },
                newRelationship: {
                  type: "string",
                  description: "For update_relationship action, the new relationship value",
                },
              },
              required: ["action", "target", "reason"],
            },
          },
        },
        required: ["name", "actions"],
      },
    },
  },
  required: ["entities"],
};

/**
 * Analyze profile against existing memories and suggest reconciliation actions
 */
async function analyzeProfileAgainstMemories(
  profile: ProfileCoreData,
  entities: EntityWithFacts[]
): Promise<ReconciliationResult> {
  const profileSummary = [
    profile.firstName && `First name: ${profile.firstName}`,
    profile.lastName && `Last name: ${profile.lastName}`,
    profile.email && `Email: ${profile.email}`,
    profile.phone && `Phone: ${profile.phone}`,
    profile.dateOfBirth && `Date of birth: ${profile.dateOfBirth}`,
    profile.street && profile.city && profile.state && profile.zip &&
      `Address: ${profile.street}, ${profile.city}, ${profile.state} ${profile.zip}`,
  ]
    .filter(Boolean)
    .join("\n");

  const entitiesSummary = entities
    .map((e) => {
      const factsList = e.facts.map((f) => `  - ${f.fact_type}: ${f.fact_value} (confidence: ${f.confidence.toFixed(2)})`).join("\n");
      return `Entity: ${e.canonical_name} (${e.relationship_to_user || "unknown relationship"}, confidence: ${e.confidence.toFixed(2)})\n${factsList || "  (no facts)"}`;
    })
    .join("\n\n");

  const prompt = `You are a memory reconciliation system. The user has updated their profile, and you need to analyze how this affects their stored memories (entities and facts).

USER'S UPDATED PROFILE:
${profileSummary}

EXISTING MEMORIES:
${entitiesSummary}

Analyze the profile against memories and suggest actions:

1. BOOST CONFIDENCE when:
   - Profile confirms a memory (e.g., profile lastName "Smith" matches entity "John Smith" who is father → father is confirmed)
   - Profile info aligns with stored facts

2. UPDATE RELATIONSHIP when:
   - Profile reveals a clearer relationship (e.g., profile lastName matches entity lastName → likely biological relative)
   - A vague relationship like "parent" can become more specific

3. REDUCE CONFIDENCE when:
   - Profile contradicts a stored fact (e.g., profile says DOB is 1990-01-01 but memory says 1991-01-01 for self)
   - Information seems outdated

4. FLAG CONFLICT when:
   - Direct contradiction that needs user attention

Rules:
- Only suggest actions where there's clear evidence from the profile
- confidenceChange should be between -0.2 and +0.2
- Don't suggest actions for entities with no relevant connection to profile data
- If no actions are needed, return an empty entities array

Return ONLY entities that need changes.`;

  try {
    const response = await generateFast({
      prompt,
      thinkingLevel: ThinkingLevel.MEDIUM, // Some reasoning needed
      jsonOutput: true,
      responseSchema: reconciliationSchema,
    });

    return JSON.parse(response) as ReconciliationResult;
  } catch (error) {
    console.error("[AutoForm] Reconciliation analysis failed:", error);
    return { entities: [] };
  }
}

/**
 * Apply reconciliation actions to the database
 */
async function applyReconciliationActions(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  entities: EntityWithFacts[],
  result: ReconciliationResult
): Promise<{ actionsApplied: number }> {
  let actionsApplied = 0;

  for (const entityResult of result.entities) {
    // Find the matching entity
    const entity = entities.find(
      (e) => e.canonical_name.toLowerCase() === entityResult.name.toLowerCase()
    );

    if (!entity) {
      console.warn(`[AutoForm] Reconciliation: Entity not found: ${entityResult.name}`);
      continue;
    }

    for (const action of entityResult.actions) {
      try {
        if (action.target === "entity") {
          // Apply action to entity
          if (action.action === "boost_confidence" || action.action === "reduce_confidence") {
            const delta = action.confidenceChange || (action.action === "boost_confidence" ? 0.1 : -0.1);
            const newConfidence = Math.max(
              0.1,
              Math.min(CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE, entity.confidence + delta)
            );

            await supabase
              .from("entities")
              .update({
                confidence: newConfidence,
                updated_at: new Date().toISOString(),
              })
              .eq("id", entity.id);

            console.log(`[AutoForm] Reconciliation: ${action.action} on entity ${entity.canonical_name}`, {
              oldConfidence: entity.confidence,
              newConfidence,
              reason: action.reason,
            });
            actionsApplied++;
          } else if (action.action === "update_relationship" && action.newRelationship) {
            await supabase
              .from("entities")
              .update({
                relationship_to_user: action.newRelationship,
                updated_at: new Date().toISOString(),
              })
              .eq("id", entity.id);

            console.log(`[AutoForm] Reconciliation: Updated relationship for ${entity.canonical_name}`, {
              oldRelationship: entity.relationship_to_user,
              newRelationship: action.newRelationship,
              reason: action.reason,
            });
            actionsApplied++;
          }
        } else if (action.target === "fact" && action.factType) {
          // Apply action to specific fact
          const fact = entity.facts.find(
            (f) => f.fact_type.toLowerCase() === action.factType!.toLowerCase()
          );

          if (!fact) {
            console.warn(`[AutoForm] Reconciliation: Fact not found: ${action.factType} on ${entity.canonical_name}`);
            continue;
          }

          if (action.action === "boost_confidence" || action.action === "reduce_confidence") {
            const delta = action.confidenceChange || (action.action === "boost_confidence" ? 0.1 : -0.1);
            const newConfidence = Math.max(
              0.1,
              Math.min(CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE, fact.confidence + delta)
            );

            await supabase
              .from("entity_facts")
              .update({ confidence: newConfidence })
              .eq("id", fact.id);

            console.log(`[AutoForm] Reconciliation: ${action.action} on fact ${action.factType}`, {
              entity: entity.canonical_name,
              oldConfidence: fact.confidence,
              newConfidence,
              reason: action.reason,
            });
            actionsApplied++;
          } else if (action.action === "flag_conflict") {
            await supabase
              .from("entity_facts")
              .update({ has_conflict: true })
              .eq("id", fact.id);

            console.log(`[AutoForm] Reconciliation: Flagged conflict on fact ${action.factType}`, {
              entity: entity.canonical_name,
              reason: action.reason,
            });
            actionsApplied++;
          }
        }
      } catch (error) {
        console.error(`[AutoForm] Reconciliation action failed:`, { action, error });
      }
    }
  }

  return { actionsApplied };
}

/**
 * Main reconciliation function - called when profile is updated
 */
export async function reconcileMemoriesWithProfile(
  userId: string,
  profile: ProfileCoreData
): Promise<{ success: boolean; actionsApplied: number }> {
  const startTime = Date.now();
  const supabase = createAdminClient();

  try {
    // Step 1: Sync profile to self entity (profile is source of truth)
    const { factsSynced } = await syncProfileToSelfEntity(supabase, userId, profile);
    console.log("[AutoForm] Profile synced to self entity:", { factsSynced });

    // Step 2: Fetch all entities with their facts for relationship analysis
    const { data: entitiesData, error: entitiesError } = await supabase
      .from("entities")
      .select("*")
      .eq("user_id", userId);

    if (entitiesError) {
      throw new Error(`Failed to fetch entities: ${entitiesError.message}`);
    }

    if (!entitiesData || entitiesData.length === 0) {
      console.log("[AutoForm] Reconciliation: No entities to reconcile");
      return { success: true, actionsApplied: 0 };
    }

    // Fetch facts for all entities
    const entityIds = entitiesData.map((e) => e.id);
    const { data: factsData, error: factsError } = await supabase
      .from("entity_facts")
      .select("*")
      .in("entity_id", entityIds);

    if (factsError) {
      throw new Error(`Failed to fetch facts: ${factsError.message}`);
    }

    // Combine entities with their facts
    const entitiesWithFacts: EntityWithFacts[] = entitiesData.map((entity) => ({
      ...entity,
      facts: (factsData || []).filter((f) => f.entity_id === entity.id),
    }));

    console.log("[AutoForm] Reconciliation starting:", {
      entityCount: entitiesWithFacts.length,
      factCount: factsData?.length || 0,
      profile: {
        hasFirstName: !!profile.firstName,
        hasLastName: !!profile.lastName,
        hasEmail: !!profile.email,
        hasDOB: !!profile.dateOfBirth,
      },
    });

    // Analyze profile against memories
    const result = await analyzeProfileAgainstMemories(profile, entitiesWithFacts);

    if (result.entities.length === 0) {
      console.log("[AutoForm] Reconciliation: No actions needed");
      return { success: true, actionsApplied: 0 };
    }

    // Apply the actions
    const { actionsApplied } = await applyReconciliationActions(
      supabase,
      userId,
      entitiesWithFacts,
      result
    );

    const duration = Date.now() - startTime;
    console.log(`[AutoForm] Reconciliation completed in ${duration}ms`, {
      entitiesAffected: result.entities.length,
      actionsApplied,
    });

    return { success: true, actionsApplied };
  } catch (error) {
    console.error("[AutoForm] Reconciliation failed:", error);
    return { success: false, actionsApplied: 0 };
  }
}
