-- Entity-centric memory system migration
-- Replaces flat memory storage with structured entities, facts, and relationships

-- Enable vector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Core entities (people, places, organizations)
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'place', 'organization')),
  canonical_name TEXT NOT NULL,
  relationship_to_user TEXT, -- 'self', 'child', 'spouse', 'grandmother', 'employer', etc.
  confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  access_count INT DEFAULT 0,
  embedding extensions.vector(384), -- gte-small model dimensions
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Facts about entities (name variations, DOB, phone, etc.)
CREATE TABLE entity_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities ON DELETE CASCADE NOT NULL,
  fact_type TEXT NOT NULL, -- 'full_name', 'first_name', 'last_name', 'birthdate', 'gender', 'ssn', 'phone', 'email', 'address', 'pronouns', 'race', etc.
  fact_value TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_document_id UUID REFERENCES documents ON DELETE SET NULL,
  source_question TEXT,
  embedding extensions.vector(384),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  access_count INT DEFAULT 0,
  has_conflict BOOLEAN DEFAULT false,
  conflicting_fact_id UUID REFERENCES entity_facts ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, fact_type, fact_value) -- Prevent exact duplicates
);

-- Relationships between entities
CREATE TABLE entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_entity_id UUID REFERENCES entities ON DELETE CASCADE NOT NULL,
  predicate TEXT NOT NULL, -- 'parent_of', 'child_of', 'spouse_of', 'grandparent_of', 'sibling_of', 'lives_at', 'works_at'
  object_entity_id UUID REFERENCES entities ON DELETE CASCADE NOT NULL,
  confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_entity_id, predicate, object_entity_id)
);

-- Indexes for efficient querying
CREATE INDEX idx_entities_user_id ON entities(user_id);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_confidence ON entities(confidence);
CREATE INDEX idx_entities_last_accessed ON entities(last_accessed_at);

CREATE INDEX idx_entity_facts_entity_id ON entity_facts(entity_id);
CREATE INDEX idx_entity_facts_type ON entity_facts(fact_type);
CREATE INDEX idx_entity_facts_confidence ON entity_facts(confidence);
CREATE INDEX idx_entity_facts_conflict ON entity_facts(has_conflict) WHERE has_conflict = true;

CREATE INDEX idx_entity_relationships_subject ON entity_relationships(subject_entity_id);
CREATE INDEX idx_entity_relationships_object ON entity_relationships(object_entity_id);
CREATE INDEX idx_entity_relationships_predicate ON entity_relationships(predicate);

-- Vector indexes for similarity search (HNSW for better performance on smaller datasets)
CREATE INDEX idx_entities_embedding ON entities USING hnsw (embedding extensions.vector_ip_ops);
CREATE INDEX idx_entity_facts_embedding ON entity_facts USING hnsw (embedding extensions.vector_ip_ops);

-- Function to get user's conflict count for sidebar badge
CREATE OR REPLACE FUNCTION get_user_conflict_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM entity_facts ef
  JOIN entities e ON ef.entity_id = e.id
  WHERE e.user_id = p_user_id AND ef.has_conflict = true;
$$;

-- Function to find similar entities by embedding
CREATE OR REPLACE FUNCTION match_entities(
  p_user_id UUID,
  query_embedding extensions.vector(384),
  match_threshold FLOAT DEFAULT 0.85,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  canonical_name TEXT,
  entity_type TEXT,
  relationship_to_user TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.canonical_name,
    e.entity_type,
    e.relationship_to_user,
    (1 + (e.embedding <#> query_embedding))::FLOAT AS similarity -- Convert negative inner product to similarity
  FROM entities e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND (1 + (e.embedding <#> query_embedding)) > match_threshold
  ORDER BY e.embedding <#> query_embedding -- Lower distance = more similar
  LIMIT match_count;
END;
$$;

-- Function to update access tracking (called when memory is used)
CREATE OR REPLACE FUNCTION update_entity_access(p_entity_id UUID)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE entities
  SET
    last_accessed_at = now(),
    access_count = access_count + 1
  WHERE id = p_entity_id;
$$;

CREATE OR REPLACE FUNCTION update_fact_access(p_fact_id UUID)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE entity_facts
  SET
    last_accessed_at = now(),
    access_count = access_count + 1
  WHERE id = p_fact_id;
$$;

-- Function to calculate fact score for pruning (higher = keep)
CREATE OR REPLACE FUNCTION calculate_fact_score(
  p_confidence FLOAT,
  p_last_accessed_at TIMESTAMPTZ,
  p_access_count INT
)
RETURNS FLOAT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    p_confidence *
    (1.0 / (EXTRACT(EPOCH FROM (now() - p_last_accessed_at)) / 86400 + 1)) * -- recency factor
    ln(p_access_count + 2); -- access factor (ln to dampen outliers)
$$;

-- Comment on tables for documentation
COMMENT ON TABLE entities IS 'Core entities (people, places, organizations) for structured memory storage';
COMMENT ON TABLE entity_facts IS 'Facts/attributes about entities with confidence tracking and conflict detection';
COMMENT ON TABLE entity_relationships IS 'Relationships between entities (parent_of, spouse_of, lives_at, etc.)';
