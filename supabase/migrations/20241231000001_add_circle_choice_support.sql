-- Add circle_choice field type and choice_options column support
-- This enables "circle your answer" style fields (Yes/No, multiple choice)

-- Update field_type constraint to include all types (including initials which was missing)
ALTER TABLE extracted_fields
DROP CONSTRAINT IF EXISTS extracted_fields_field_type_check;

ALTER TABLE extracted_fields
ADD CONSTRAINT extracted_fields_field_type_check
CHECK (field_type IN (
  'text', 'textarea', 'checkbox', 'radio', 'date',
  'signature', 'initials', 'circle_choice', 'unknown'
));

-- Add choice_options column for storing option positions
-- Structure: [{ "label": "Yes", "coordinates": { "left": 20, "top": 51, "width": 4, "height": 4 } }, ...]
ALTER TABLE extracted_fields
ADD COLUMN IF NOT EXISTS choice_options JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN extracted_fields.choice_options IS
'For circle_choice fields: Array of {label: string, coordinates: {left, top, width, height}} for each option';
