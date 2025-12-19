-- Performance indexes

-- Fast document lookups by user
create index idx_documents_user_id on documents(user_id);
create index idx_documents_status on documents(status);
create index idx_documents_created_at on documents(created_at desc);

-- Fast field lookups by document
create index idx_extracted_fields_document_id on extracted_fields(document_id);
create index idx_extracted_fields_page on extracted_fields(document_id, page_number);

-- Exclude soft-deleted fields from queries
create index idx_extracted_fields_active on extracted_fields(document_id) where deleted_at is null;
