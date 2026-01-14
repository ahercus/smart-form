-- Add questions_pregenerated flag to documents table
-- This tracks whether questions have been pre-generated (before context submission)
-- Used for the pre-warm question generation pipeline optimization

alter table documents add column if not exists questions_pregenerated boolean default false;

-- Add comment explaining the field
comment on column documents.questions_pregenerated is 'True when questions have been pre-generated from Azure fields (before context submission). Used for pipeline optimization.';
