-- Update the status check constraint to include 'pending_context' for pre-generated questions
ALTER TABLE document_questions DROP CONSTRAINT document_questions_status_check;

ALTER TABLE document_questions ADD CONSTRAINT document_questions_status_check
CHECK (status IN ('pending', 'visible', 'answered', 'hidden', 'pending_context'));
