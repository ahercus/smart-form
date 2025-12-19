-- Create documents table for uploaded PDFs
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,

  -- File info
  original_filename text not null,
  storage_path text not null,
  file_size_bytes integer,
  page_count integer,

  -- Processing state
  -- Flow: uploading -> analyzing -> extracting -> refining -> ready (or failed)
  status text default 'uploading' check (status in (
    'uploading', 'analyzing', 'extracting', 'refining', 'ready', 'failed'
  )),
  error_message text,

  -- User-provided context
  context_notes text,

  -- Cached API responses (for cost reduction)
  document_ai_response jsonb,
  gemini_refinement_response jsonb,

  -- Rendered page images (for overlay view)
  -- Example: [{ "page": 1, "storage_path": "..." }]
  page_images jsonb default '[]',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
