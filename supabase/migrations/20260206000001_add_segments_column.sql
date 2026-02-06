-- Add segments column for linkedText fields
-- LinkedText fields have multiple rectangular segments that form a single flowing text input
-- Example: A "Details:" field with 3 continuation lines

-- Add segments column for storing segment positions
-- Structure: [{ "left": 10, "top": 30, "width": 85, "height": 2 }, { "left": 5, "top": 33, "width": 90, "height": 2 }, ...]
ALTER TABLE extracted_fields
ADD COLUMN IF NOT EXISTS segments JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN extracted_fields.segments IS
'For linkedText fields: Array of {left, top, width, height} coordinates for each segment that forms a single flowing text input';

-- Update detection_source constraint to include gemini_vision
ALTER TABLE extracted_fields
DROP CONSTRAINT IF EXISTS extracted_fields_detection_source_check;

ALTER TABLE extracted_fields
ADD CONSTRAINT extracted_fields_detection_source_check
CHECK (detection_source IN (
  'document_ai', 'gemini_refinement', 'gemini_vision', 'manual'
));
