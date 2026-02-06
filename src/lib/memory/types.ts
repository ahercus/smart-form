// Types for the entity-centric memory system

export type EntityType = "person" | "place" | "organization";

export interface Entity {
  id: string;
  user_id: string;
  entity_type: EntityType;
  canonical_name: string;
  relationship_to_user: string | null;
  confidence: number;
  last_accessed_at: string;
  access_count: number;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface EntityFact {
  id: string;
  entity_id: string;
  fact_type: string;
  fact_value: string;
  confidence: number;
  source_document_id: string | null;
  source_question: string | null;
  embedding: number[] | null;
  last_accessed_at: string;
  access_count: number;
  has_conflict: boolean;
  conflicting_fact_id: string | null;
  created_at: string;
}

export interface EntityRelationship {
  id: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id: string;
  confidence: number;
  created_at: string;
}

// Types for extraction results from Gemini
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  relationshipToUser?: string;
}

export interface ExtractedFact {
  entityName: string;
  factType: string;
  factValue: string;
}

export interface ExtractedRelationship {
  subjectName: string;
  predicate: string;
  objectName: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  facts: ExtractedFact[];
  relationships: ExtractedRelationship[];
}

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  DISPLAY: 0.3, // Show all, dim low-confidence
  AUTO_FILL: 0.5, // Only suggest if reasonably confident
  MEMORY_CHOICE: 0.6, // Include in choice buttons
  INFERRED_RELATIONSHIP: 0.7, // Only display/use if well-corroborated
} as const;

// Confidence adjustments
export const CONFIDENCE_ADJUSTMENTS = {
  BASE: 0.5, // Initial confidence for new entities/facts
  CORROBORATION_BOOST: 0.15, // When same fact from different source
  ACCESS_BOOST: 0.05, // When memory is used for auto-fill
  CONFLICT_PENALTY: -0.2, // When conflicting information found
  MAX_CONFIDENCE: 0.95, // Cap to never be 100% certain
} as const;

// Entity matching thresholds
export const MATCHING_THRESHOLDS = {
  EMBEDDING_SIMILARITY: 0.85, // Minimum similarity to consider same entity
} as const;
