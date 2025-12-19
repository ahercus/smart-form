// Supabase storage service for documents and fields

import { createAdminClient } from "./supabase/admin";
import type { Document, ExtractedField, DocumentStatus } from "./types";

const DOCUMENTS_BUCKET = "documents";

// Ensure storage bucket exists
export async function ensureStorageBucket(): Promise<void> {
  const supabase = createAdminClient();

  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === DOCUMENTS_BUCKET);

  if (!exists) {
    const { error } = await supabase.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ["application/pdf"],
    });
    if (error && !error.message.includes("already exists")) {
      console.error("[AutoForm] Failed to create storage bucket:", error);
    }
  }
}

// Upload file to storage
export async function uploadFile(
  userId: string,
  documentId: string,
  filename: string,
  fileData: ArrayBuffer
): Promise<string> {
  const supabase = createAdminClient();
  const storagePath = `${userId}/${documentId}/${filename}`;

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, fileData, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return storagePath;
}

// Get file from storage
export async function getFile(storagePath: string): Promise<ArrayBuffer> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message}`);
  }

  return data.arrayBuffer();
}

// Delete file from storage
export async function deleteFile(storagePath: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.error("[AutoForm] Failed to delete file:", error);
  }
}

// Document CRUD operations
export async function createDocument(
  userId: string,
  filename: string,
  fileData: ArrayBuffer,
  contextNotes?: string
): Promise<Document> {
  const supabase = createAdminClient();
  await ensureStorageBucket();

  // Create document record first to get ID
  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      original_filename: filename,
      storage_path: "", // Will update after upload
      file_size_bytes: fileData.byteLength,
      status: "uploading",
      context_notes: contextNotes || null,
    })
    .select()
    .single();

  if (insertError || !doc) {
    throw new Error(`Failed to create document: ${insertError?.message}`);
  }

  // Upload file to storage
  const storagePath = await uploadFile(userId, doc.id, filename, fileData);

  // Update document with storage path
  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({ storage_path: storagePath })
    .eq("id", doc.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to update document: ${updateError.message}`);
  }

  return updated as Document;
}

export async function getDocument(id: string): Promise<Document | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw new Error(`Failed to get document: ${error.message}`);
  }

  return data as Document;
}

export async function getDocumentsByUser(userId: string): Promise<Document[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to get documents: ${error.message}`);
  }

  return (data || []) as Document[];
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  errorMessage?: string
): Promise<Document | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .update({
      status,
      error_message: errorMessage || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update document status: ${error.message}`);
  }

  return data as Document;
}

export async function updateDocument(
  id: string,
  updates: Partial<Document>
): Promise<Document | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("documents")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update document: ${error.message}`);
  }

  return data as Document;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const supabase = createAdminClient();

  // Get document to find storage path
  const doc = await getDocument(id);
  if (doc?.storage_path) {
    await deleteFile(doc.storage_path);
  }

  // Delete fields first (cascade should handle this, but be safe)
  await supabase.from("extracted_fields").delete().eq("document_id", id);

  // Delete document
  const { error } = await supabase.from("documents").delete().eq("id", id);

  return !error;
}

// Field operations
export async function getDocumentFields(
  documentId: string
): Promise<ExtractedField[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("document_id", documentId)
    .is("deleted_at", null)
    .order("page_number")
    .order("field_index");

  if (error) {
    throw new Error(`Failed to get fields: ${error.message}`);
  }

  return (data || []) as ExtractedField[];
}

export async function setDocumentFields(
  documentId: string,
  fields: ExtractedField[]
): Promise<void> {
  const supabase = createAdminClient();

  // Insert all fields
  const { error } = await supabase.from("extracted_fields").insert(
    fields.map((f) => ({
      ...f,
      document_id: documentId,
    }))
  );

  if (error) {
    throw new Error(`Failed to save fields: ${error.message}`);
  }
}

export async function updateField(
  fieldId: string,
  updates: Partial<ExtractedField>
): Promise<ExtractedField | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("extracted_fields")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", fieldId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update field: ${error.message}`);
  }

  return data as ExtractedField;
}
