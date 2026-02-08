-- Add group_label column to extracted_fields table
-- This stores the question/header/section context that a field belongs to
-- Used by question generation to create better, more contextual questions

ALTER TABLE extracted_fields ADD COLUMN IF NOT EXISTS group_label TEXT;

COMMENT ON COLUMN extracted_fields.group_label IS 'Question/header/section text that this field belongs to (for context in question generation)';
