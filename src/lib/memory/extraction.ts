// Entity extraction from form answers using Gemini 3 Pro
// Uses Pro model (not Flash) because entity/relationship reasoning requires
// deeper inference. Extracts people, places, organizations and their attributes.
// Sensitive data (SSN, credit cards, etc.) is explicitly filtered post-extraction.

import { ThinkingLevel } from "@google/genai";
import { generateWithVision } from "@/lib/gemini/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateEmbedding, generateEmbeddings } from "./embeddings";
import {
  Entity,
  EntityFact,
  ExtractionResult,
  ExtractedEntity,
  ExtractedFact,
  ExtractedRelationship,
  CONFIDENCE_ADJUSTMENTS,
  MATCHING_THRESHOLDS,
} from "./types";

// Sensitive fact types that should NEVER be stored in memory
// These are filtered out after extraction to prevent accidental storage
const SENSITIVE_FACT_TYPES = new Set([
  "ssn",
  "social_security",
  "social_security_number",
  "credit_card",
  "credit_card_number",
  "card_number",
  "cvv",
  "cvc",
  "security_code",
  "pin",
  "password",
  "bank_account",
  "bank_account_number",
  "routing_number",
  "drivers_license",
  "drivers_license_number",
  "passport",
  "passport_number",
  "tax_id",
  "ein",
  "itin",
]);

// Patterns that indicate sensitive data in fact values
const SENSITIVE_VALUE_PATTERNS = [
  /^\d{3}-\d{2}-\d{4}$/, // SSN format
  /^\d{9}$/, // SSN without dashes
  /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/, // Credit card
  /^\d{15,16}$/, // Credit card without spaces
];

/**
 * Check if a fact contains sensitive information
 */
function isSensitiveFact(fact: ExtractedFact): boolean {
  const factTypeLower = fact.factType.toLowerCase().replace(/[\s_-]/g, "_");

  // Check fact type
  if (SENSITIVE_FACT_TYPES.has(factTypeLower)) {
    return true;
  }

  // Check for sensitive patterns in value
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(fact.factValue)) {
      return true;
    }
  }

  return false;
}

// JSON Schema for structured extraction output
const extractionSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The name of the entity" },
          type: {
            type: "string",
            enum: ["person", "place", "organization"],
          },
          relationshipToUser: {
            type: "string",
            description:
              "Relationship to the user filling the form, e.g., 'child', 'spouse', 'self', 'employer', 'grandmother'",
          },
        },
        required: ["name", "type"],
      },
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityName: {
            type: "string",
            description: "Name of the entity this fact is about",
          },
          factType: {
            type: "string",
            description:
              "Type of fact: full_name, first_name, last_name, birthdate, gender, ssn, phone, email, address, pronouns, race, occupation, etc.",
          },
          factValue: { type: "string", description: "The value of the fact" },
        },
        required: ["entityName", "factType", "factValue"],
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subjectName: { type: "string" },
          predicate: {
            type: "string",
            description:
              "Relationship type: parent_of, child_of, spouse_of, grandparent_of, sibling_of, lives_at, works_at, etc.",
          },
          objectName: { type: "string" },
        },
        required: ["subjectName", "predicate", "objectName"],
      },
    },
  },
  required: ["entities", "facts", "relationships"],
};

/**
 * Extracts entities, facts, and relationships from a question-answer pair.
 * Uses Gemini Pro with LOW thinking for entity reasoning.
 * Filters sensitive data (SSN, credit cards) before returning results.
 */
export async function extractFromAnswer(
  question: string,
  answer: string,
  existingEntities: Array<{ canonical_name: string; relationship_to_user: string | null }>
): Promise<ExtractionResult> {
  const existingContext =
    existingEntities.length > 0
      ? `\nUser's existing known entities:\n${existingEntities
          .map((e) => `- ${e.canonical_name}${e.relationship_to_user ? ` (${e.relationship_to_user})` : ""}`)
          .join("\n")}`
      : "";

  const prompt = `You are extracting structured information from a form answer for a personal memory system.
The user is filling out a form (like school enrollment, medical forms, etc.) and we want to remember key facts for future forms.

Question: "${question}"
Answer: "${answer}"
${existingContext}

Extract:
1. ENTITIES: People, places, or organizations mentioned in the answer
   - Include name, type (person/place/organization), and relationship to user if clear
   - If the answer is about the user themselves (e.g., "my name is...", "I am..."), the relationship is "self"
   - If the answer mentions a child, spouse, parent, etc., capture that relationship
   - Use existing entities when the answer refers to someone already known

2. FACTS: Specific attributes about entities
   - factType should be specific: full_name, first_name, last_name, birthdate, gender, phone, email, street_address, city, state, zip, pronouns, race, ethnicity, occupation, school, grade, etc.
   - Normalize dates to YYYY-MM-DD format
   - If the user provides info about themselves without naming, use "user" as the entityName
   - NEVER extract sensitive data: SSN, credit card numbers, bank accounts, passwords, PINs, driver's license numbers, passport numbers

3. RELATIONSHIPS: Explicit relationships between entities
   - Only include if the relationship is clearly stated or implied
   - Use predicates like: parent_of, child_of, spouse_of, grandparent_of, sibling_of, lives_at, works_at

Rules:
- Only extract information that is clearly stated or strongly implied
- Don't invent or assume information
- If the answer is too vague or doesn't contain extractable information, return empty arrays
- Merge with existing entities when names match (e.g., if "Jude" exists and answer mentions "Jude", use the same entity)
- Strip form-specific context (like "victim" in crime reports) - store the general information`;

  try {
    const startTime = Date.now();
    const response = await generateWithVision({
      prompt,
      thinkingLevel: ThinkingLevel.LOW, // Pro maps MINIMAL to LOW
      jsonOutput: true,
      responseSchema: extractionSchema,
    });
    const duration = Date.now() - startTime;
    console.log(`[AutoForm] Entity extraction completed in ${duration}ms`);

    const result = JSON.parse(response) as ExtractionResult;

    // Validate and clean the result
    const validFacts = (result.facts || []).filter(
      (f) => f.entityName && f.factType && f.factValue
    );

    // Filter out sensitive facts
    const safeFacts = validFacts.filter((f) => {
      if (isSensitiveFact(f)) {
        console.log("[AutoForm] Filtered sensitive fact:", { factType: f.factType });
        return false;
      }
      return true;
    });

    return {
      entities: (result.entities || []).filter(
        (e) => e.name && e.type && ["person", "place", "organization"].includes(e.type)
      ),
      facts: safeFacts,
      relationships: (result.relationships || []).filter(
        (r) => r.subjectName && r.predicate && r.objectName
      ),
    };
  } catch (error) {
    console.error("[AutoForm] Entity extraction failed:", error);
    return { entities: [], facts: [], relationships: [] };
  }
}

/**
 * Find an existing entity by name match or embedding similarity
 */
async function findMatchingEntity(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  entityName: string,
  embedding: number[]
): Promise<Entity | null> {
  // First try exact name match (case-insensitive)
  const { data: exactMatch } = await supabase
    .from("entities")
    .select("*")
    .eq("user_id", userId)
    .ilike("canonical_name", entityName)
    .single();

  if (exactMatch) {
    return exactMatch as Entity;
  }

  // If we have an embedding, try similarity search
  if (embedding.length > 0) {
    const { data: similarMatches } = await supabase.rpc("match_entities", {
      p_user_id: userId,
      query_embedding: embedding,
      match_threshold: MATCHING_THRESHOLDS.EMBEDDING_SIMILARITY,
      match_count: 1,
    });

    if (similarMatches && similarMatches.length > 0) {
      // Fetch the full entity
      const { data: entity } = await supabase
        .from("entities")
        .select("*")
        .eq("id", similarMatches[0].id)
        .single();

      if (entity) {
        console.log("[AutoForm] Found similar entity:", {
          searchName: entityName,
          matchedName: similarMatches[0].canonical_name,
          similarity: similarMatches[0].similarity,
        });
        return entity as Entity;
      }
    }
  }

  return null;
}

/**
 * Create or update an entity and return its ID
 */
async function upsertEntity(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  extracted: ExtractedEntity,
  embedding: number[]
): Promise<string> {
  // Check for existing entity
  const existing = await findMatchingEntity(supabase, userId, extracted.name, embedding);

  if (existing) {
    // Update confidence (corroboration boost)
    const newConfidence = Math.min(
      existing.confidence + CONFIDENCE_ADJUSTMENTS.CORROBORATION_BOOST,
      CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE
    );

    // Update relationship if we now have more specific info
    const updates: Partial<Entity> = {
      confidence: newConfidence,
      updated_at: new Date().toISOString(),
    };

    // Only update relationship if we have new info and didn't have it before
    if (extracted.relationshipToUser && !existing.relationship_to_user) {
      updates.relationship_to_user = extracted.relationshipToUser;
    }

    await supabase.from("entities").update(updates).eq("id", existing.id);

    console.log("[AutoForm] Updated existing entity:", {
      name: existing.canonical_name,
      oldConfidence: existing.confidence,
      newConfidence,
    });

    return existing.id;
  }

  // Create new entity
  const { data: newEntity, error } = await supabase
    .from("entities")
    .insert({
      user_id: userId,
      entity_type: extracted.type,
      canonical_name: extracted.name,
      relationship_to_user: extracted.relationshipToUser || null,
      confidence: CONFIDENCE_ADJUSTMENTS.BASE,
      embedding: embedding.length > 0 ? embedding : null,
    })
    .select("id")
    .single();

  if (error || !newEntity) {
    throw new Error(`Failed to create entity: ${error?.message}`);
  }

  console.log("[AutoForm] Created new entity:", {
    name: extracted.name,
    type: extracted.type,
    relationship: extracted.relationshipToUser,
  });

  return newEntity.id;
}

/**
 * Add a fact to an entity, handling conflicts
 */
async function addFact(
  supabase: ReturnType<typeof createAdminClient>,
  entityId: string,
  fact: ExtractedFact,
  documentId: string | null,
  question: string,
  embedding: number[]
): Promise<void> {
  // Check if we already have this exact fact
  const { data: existingExact } = await supabase
    .from("entity_facts")
    .select("id, confidence")
    .eq("entity_id", entityId)
    .eq("fact_type", fact.factType)
    .eq("fact_value", fact.factValue)
    .single();

  if (existingExact) {
    // Same fact from different source - boost confidence
    const newConfidence = Math.min(
      existingExact.confidence + CONFIDENCE_ADJUSTMENTS.CORROBORATION_BOOST,
      CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE
    );

    await supabase
      .from("entity_facts")
      .update({ confidence: newConfidence })
      .eq("id", existingExact.id);

    console.log("[AutoForm] Boosted fact confidence:", {
      factType: fact.factType,
      factValue: fact.factValue,
      newConfidence,
    });
    return;
  }

  // Check for conflicting fact (same type, different value)
  const { data: conflicting } = await supabase
    .from("entity_facts")
    .select("id, fact_value")
    .eq("entity_id", entityId)
    .eq("fact_type", fact.factType)
    .neq("fact_value", fact.factValue)
    .limit(1)
    .single();

  // Insert the new fact
  const { data: newFact, error } = await supabase
    .from("entity_facts")
    .insert({
      entity_id: entityId,
      fact_type: fact.factType,
      fact_value: fact.factValue,
      confidence: CONFIDENCE_ADJUSTMENTS.BASE,
      source_document_id: documentId,
      source_question: question,
      embedding: embedding.length > 0 ? embedding : null,
      has_conflict: !!conflicting,
      conflicting_fact_id: conflicting?.id || null,
    })
    .select("id")
    .single();

  if (error) {
    // Might be duplicate, which is fine
    if (!error.message.includes("duplicate")) {
      console.error("[AutoForm] Failed to add fact:", error);
    }
    return;
  }

  // If there was a conflict, mark the existing fact too
  if (conflicting && newFact) {
    await supabase
      .from("entity_facts")
      .update({
        has_conflict: true,
        conflicting_fact_id: newFact.id,
        confidence: Math.max(
          0.1,
          CONFIDENCE_ADJUSTMENTS.BASE + CONFIDENCE_ADJUSTMENTS.CONFLICT_PENALTY
        ),
      })
      .eq("id", conflicting.id);

    console.log("[AutoForm] Detected fact conflict:", {
      factType: fact.factType,
      existingValue: conflicting.fact_value,
      newValue: fact.factValue,
    });
  }
}

/**
 * Add a relationship between entities
 */
async function addRelationship(
  supabase: ReturnType<typeof createAdminClient>,
  subjectId: string,
  predicate: string,
  objectId: string
): Promise<void> {
  // Check if relationship already exists
  const { data: existing } = await supabase
    .from("entity_relationships")
    .select("id, confidence")
    .eq("subject_entity_id", subjectId)
    .eq("predicate", predicate)
    .eq("object_entity_id", objectId)
    .single();

  if (existing) {
    // Boost confidence on corroboration
    const newConfidence = Math.min(
      existing.confidence + CONFIDENCE_ADJUSTMENTS.CORROBORATION_BOOST,
      CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE
    );

    await supabase
      .from("entity_relationships")
      .update({ confidence: newConfidence })
      .eq("id", existing.id);

    return;
  }

  // Insert new relationship
  const { error } = await supabase.from("entity_relationships").insert({
    subject_entity_id: subjectId,
    predicate,
    object_entity_id: objectId,
    confidence: CONFIDENCE_ADJUSTMENTS.BASE,
  });

  if (error && !error.message.includes("duplicate")) {
    console.error("[AutoForm] Failed to add relationship:", error);
  }
}

/**
 * Main function: Extract entities from a form answer and store them
 * This is called as a background job after the user submits an answer
 */
export async function extractEntitiesFromAnswer(
  userId: string,
  question: string,
  answer: string,
  documentId: string | null
): Promise<void> {
  const startTime = Date.now();
  const supabase = createAdminClient();

  try {
    // Get existing entities for context
    const { data: existingEntities } = await supabase
      .from("entities")
      .select("canonical_name, relationship_to_user")
      .eq("user_id", userId);

    // Extract information using Gemini
    const extraction = await extractFromAnswer(
      question,
      answer,
      existingEntities || []
    );

    if (
      extraction.entities.length === 0 &&
      extraction.facts.length === 0 &&
      extraction.relationships.length === 0
    ) {
      console.log("[AutoForm] No extractable information found in answer");
      return;
    }

    console.log("[AutoForm] Extraction result:", {
      entities: extraction.entities.length,
      facts: extraction.facts.length,
      relationships: extraction.relationships.length,
    });

    // Generate embeddings for entities and facts
    const entityNames = extraction.entities.map((e) => e.name);
    const factTexts = extraction.facts.map(
      (f) => `${f.entityName} ${f.factType}: ${f.factValue}`
    );
    const allTexts = [...entityNames, ...factTexts];

    const embeddings = allTexts.length > 0 ? await generateEmbeddings(allTexts) : [];
    const entityEmbeddings = embeddings.slice(0, entityNames.length);
    const factEmbeddings = embeddings.slice(entityNames.length);

    // Create/update entities and build name->id map
    const entityIdMap = new Map<string, string>();

    for (let i = 0; i < extraction.entities.length; i++) {
      const entity = extraction.entities[i];
      const embedding = entityEmbeddings[i] || [];
      const entityId = await upsertEntity(supabase, userId, entity, embedding);
      entityIdMap.set(entity.name.toLowerCase(), entityId);
    }

    // Add facts
    for (let i = 0; i < extraction.facts.length; i++) {
      const fact = extraction.facts[i];
      const embedding = factEmbeddings[i] || [];

      // Find the entity ID
      let entityId = entityIdMap.get(fact.entityName.toLowerCase());

      // If not in our extraction, check if it's an existing entity
      if (!entityId) {
        const { data: existingEntity } = await supabase
          .from("entities")
          .select("id")
          .eq("user_id", userId)
          .ilike("canonical_name", fact.entityName)
          .single();

        if (existingEntity) {
          entityId = existingEntity.id;
        }
      }

      // If still no entity, check if entityName is "user" (self reference)
      if (!entityId && fact.entityName.toLowerCase() === "user") {
        // Find or create the "self" entity
        const { data: selfEntity } = await supabase
          .from("entities")
          .select("id")
          .eq("user_id", userId)
          .eq("relationship_to_user", "self")
          .single();

        if (selfEntity) {
          entityId = selfEntity.id;
        } else {
          // Create a self entity
          const selfEmbedding = await generateEmbedding("user self");
          const { data: newSelf } = await supabase
            .from("entities")
            .insert({
              user_id: userId,
              entity_type: "person",
              canonical_name: "Me",
              relationship_to_user: "self",
              confidence: 0.9,
              embedding: selfEmbedding.length > 0 ? selfEmbedding : null,
            })
            .select("id")
            .single();

          if (newSelf) {
            entityId = newSelf.id;
          }
        }
      }

      if (entityId) {
        await addFact(supabase, entityId, fact, documentId, question, embedding);
      } else {
        console.warn("[AutoForm] Could not find entity for fact:", fact);
      }
    }

    // Add relationships
    for (const rel of extraction.relationships) {
      const subjectId = entityIdMap.get(rel.subjectName.toLowerCase());
      const objectId = entityIdMap.get(rel.objectName.toLowerCase());

      // Try to find in existing entities if not in current extraction
      let finalSubjectId = subjectId;
      let finalObjectId = objectId;

      if (!finalSubjectId) {
        const { data } = await supabase
          .from("entities")
          .select("id")
          .eq("user_id", userId)
          .ilike("canonical_name", rel.subjectName)
          .single();
        finalSubjectId = data?.id;
      }

      if (!finalObjectId) {
        const { data } = await supabase
          .from("entities")
          .select("id")
          .eq("user_id", userId)
          .ilike("canonical_name", rel.objectName)
          .single();
        finalObjectId = data?.id;
      }

      if (finalSubjectId && finalObjectId) {
        await addRelationship(supabase, finalSubjectId, rel.predicate, finalObjectId);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AutoForm] Entity extraction pipeline completed in ${duration}ms`);
  } catch (error) {
    console.error("[AutoForm] Entity extraction pipeline failed:", error);
    // Don't throw - this is a background job
  }
}
