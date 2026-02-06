-- Add circle_choice to document_questions input_type check constraint
ALTER TABLE document_questions DROP CONSTRAINT IF EXISTS document_questions_input_type_check;

ALTER TABLE document_questions ADD CONSTRAINT document_questions_input_type_check
CHECK (input_type IN ('text', 'textarea', 'checkbox', 'radio', 'date', 'signature', 'initials', 'circle_choice', 'unknown'));
