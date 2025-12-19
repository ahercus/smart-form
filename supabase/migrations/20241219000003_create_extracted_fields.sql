-- Create extracted_fields table for individual form fields
create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,

  -- Field identification
  page_number integer not null,
  field_index integer not null,

  -- Label and type
  label text not null,
  field_type text not null check (field_type in (
    'text', 'textarea', 'checkbox', 'radio', 'date', 'signature', 'unknown'
  )),

  -- Position (percentage-based, 0-100)
  -- Example: { "left": 10.5, "top": 25.2, "width": 30.0, "height": 3.5 }
  coordinates jsonb not null,

  -- Values
  value text,
  ai_suggested_value text,
  ai_confidence float,

  -- Help content (pre-generated explanation for info popover)
  help_text text,

  -- Metadata
  detection_source text default 'document_ai' check (detection_source in (
    'document_ai', 'gemini_refinement', 'manual'
  )),
  confidence_score float,
  manually_adjusted boolean default false,

  -- Soft delete for undo capability
  deleted_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(document_id, page_number, field_index)
);
