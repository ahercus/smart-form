-- Enable Supabase Realtime for key tables
-- This allows the frontend to receive live updates via websockets

-- Add tables to the realtime publication
-- Note: document_questions may already be added, so we use IF NOT EXISTS pattern
DO $$
BEGIN
  -- Check if documents is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE documents;
  END IF;

  -- Check if extracted_fields is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'extracted_fields'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE extracted_fields;
  END IF;

  -- Check if document_questions is already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'document_questions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE document_questions;
  END IF;
END $$;

COMMENT ON TABLE documents IS 'Main document records - Realtime enabled for status updates';
COMMENT ON TABLE extracted_fields IS 'Form fields extracted from PDFs - Realtime enabled for live updates';
