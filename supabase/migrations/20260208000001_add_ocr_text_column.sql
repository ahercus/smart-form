-- Add OCR text column for full document text extraction
-- Used by question writer for cross-page context and entity detection

alter table documents add column if not exists ocr_text text;
alter table documents add column if not exists ocr_completed_at timestamptz;

-- Index for checking OCR completion status
create index if not exists idx_documents_ocr_completed on documents(id) where ocr_completed_at is not null;

comment on column documents.ocr_text is 'Full document text extracted via Azure Document Intelligence OCR';
comment on column documents.ocr_completed_at is 'Timestamp when OCR completed, null if pending';
