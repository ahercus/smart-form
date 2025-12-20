-- Migration to switch from Google Document AI to Azure Document Intelligence

-- Rename document_ai_response to extraction_response
ALTER TABLE documents
RENAME COLUMN document_ai_response TO extraction_response;

-- Update detection_source constraint in extracted_fields to include azure_document_intelligence
ALTER TABLE extracted_fields
DROP CONSTRAINT IF EXISTS extracted_fields_detection_source_check;

ALTER TABLE extracted_fields
ADD CONSTRAINT extracted_fields_detection_source_check
CHECK (detection_source IN (
  'document_ai',
  'azure_document_intelligence',
  'gemini_refinement',
  'gemini_vision',
  'manual'
));

-- Update default detection_source to azure_document_intelligence
ALTER TABLE extracted_fields
ALTER COLUMN detection_source SET DEFAULT 'azure_document_intelligence';

-- Add comment for clarity
COMMENT ON COLUMN documents.extraction_response IS 'Raw response from Azure Document Intelligence (formerly Google Document AI)';
