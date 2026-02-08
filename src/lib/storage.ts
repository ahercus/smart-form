// Supabase storage service for documents and fields

import { createAdminClient } from "./supabase/admin";
import type { Document, ExtractedField, DocumentStatus, FieldType, NormalizedCoordinates, DateSegment, TableConfig } from "./types";

// Type for inserting new fields (without auto-generated fields)
export type InsertableField = Omit<ExtractedField, "id" | "created_at" | "updated_at" | "deleted_at" | "field_index">;

// Simplified field type for extraction results (converted to InsertableField on save)
export interface ExtractionField {
  label: string;
  fieldType: FieldType;
  coordinates: NormalizedCoordinates;
  groupLabel?: string | null;
  rows?: number | null;
  tableConfig?: TableConfig | null;
  dateSegments?: DateSegment[] | null;
  segments?: NormalizedCoordinates[] | null;
}

const DOCUMENTS_BUCKET = "documents";

// Ensure storage bucket exists
export async function ensureStorageBucket(): Promise<void> {
  const supabase = createAdminClient();

  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === DOCUMENTS_BUCKET);

  if (!exists) {
    const { error } = await supabase.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024, // 50MB (for PDFs + page images)
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
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

  const documents = (data || []) as Document[];

  // Fetch field counts for all documents in parallel
  if (documents.length > 0) {
    const documentIds = documents.map((d) => d.id);

    const { data: fieldData } = await supabase
      .from("extracted_fields")
      .select("document_id, value")
      .in("document_id", documentIds);

    if (fieldData) {
      // Group by document_id and count
      const fieldStats = new Map<string, { total: number; filled: number }>();
      for (const field of fieldData) {
        const stats = fieldStats.get(field.document_id) || { total: 0, filled: 0 };
        stats.total++;
        if (field.value && field.value.trim() !== "") {
          stats.filled++;
        }
        fieldStats.set(field.document_id, stats);
      }

      // Add stats to documents
      for (const doc of documents) {
        const stats = fieldStats.get(doc.id);
        if (stats) {
          doc.total_fields = stats.total;
          doc.filled_fields = stats.filled;
        }
      }
    }
  }

  return documents;
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

  // Get document to find storage path and user_id
  const doc = await getDocument(id);

  if (doc?.user_id) {
    // Delete ALL files in the document folder (PDF, page images, composites)
    const folderPath = `${doc.user_id}/${id}`;

    // List all files in the folder
    const { data: files } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(folderPath, { limit: 1000 });

    if (files && files.length > 0) {
      // Delete files in root of document folder
      const rootFiles = files
        .filter(f => f.name && !f.id) // Files have name, folders have id
        .map(f => `${folderPath}/${f.name}`);

      if (rootFiles.length > 0) {
        await supabase.storage.from(DOCUMENTS_BUCKET).remove(rootFiles);
      }
    }

    // List and delete files in /pages subfolder
    const { data: pageFiles } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(`${folderPath}/pages`, { limit: 1000 });

    if (pageFiles && pageFiles.length > 0) {
      const pagePaths = pageFiles.map(f => `${folderPath}/pages/${f.name}`);
      await supabase.storage.from(DOCUMENTS_BUCKET).remove(pagePaths);
    }

    // List and delete files in /composites subfolder
    const { data: compositeFiles } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(`${folderPath}/composites`, { limit: 1000 });

    if (compositeFiles && compositeFiles.length > 0) {
      const compositePaths = compositeFiles.map(f => `${folderPath}/composites/${f.name}`);
      await supabase.storage.from(DOCUMENTS_BUCKET).remove(compositePaths);
    }

    console.log("[AutoForm] Deleted storage files for document:", id);
  }

  // Delete document (cascade will handle extracted_fields and document_questions)
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

  // Delete existing fields for this document first (prevents duplicate key errors on reprocess)
  const { error: deleteError } = await supabase
    .from("extracted_fields")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) {
    console.error("[AutoForm] Failed to delete existing fields:", deleteError);
    // Continue anyway - insert might still work if no existing fields
  }

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

/**
 * Set fields for a specific page only (used for progressive page-by-page saving)
 * Only deletes/replaces fields for the specified page, not the entire document
 *
 * Accepts ExtractionField[] from Gemini extraction and converts to DB format
 */
export async function setPageFields(
  documentId: string,
  pageNumber: number,
  fields: ExtractionField[]
): Promise<void> {
  const supabase = createAdminClient();

  // Delete existing fields for this specific page only
  const { error: deleteError } = await supabase
    .from("extracted_fields")
    .delete()
    .eq("document_id", documentId)
    .eq("page_number", pageNumber);

  if (deleteError) {
    console.error("[AutoForm] Failed to delete existing page fields:", deleteError);
    // Continue anyway - insert might still work if no existing fields
  }

  if (fields.length === 0) {
    return; // No fields to insert for this page
  }

  // Convert ExtractionField to DB format
  const dbFields = fields.map((f) => ({
    document_id: documentId,
    page_number: pageNumber,
    label: f.label,
    field_type: f.fieldType,
    coordinates: f.coordinates,
    value: null,
    ai_suggested_value: null,
    ai_confidence: null,
    help_text: null,
    detection_source: "gemini_vision" as const,
    confidence_score: null,
    manually_adjusted: false,
    choice_options: null,
    segments: f.segments ?? null,
    date_segments: f.dateSegments ?? null,
    table_config: f.tableConfig ?? null,
    rows: f.rows ?? null,
    group_label: f.groupLabel ?? null,
  }));

  // Insert fields for this page
  const { error } = await supabase.from("extracted_fields").insert(dbFields);

  if (error) {
    throw new Error(`Failed to save page fields: ${error.message}`);
  }

  console.log("[AutoForm] Page fields saved:", {
    documentId: documentId.slice(0, 8),
    pageNumber,
    fieldCount: fields.length,
  });
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

export async function getField(fieldId: string): Promise<ExtractedField | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("id", fieldId)
    .is("deleted_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get field: ${error.message}`);
  }

  return data as ExtractedField;
}

export async function createField(
  field: Omit<ExtractedField, "id" | "field_index" | "created_at" | "updated_at" | "deleted_at">
): Promise<ExtractedField> {
  const supabase = createAdminClient();

  // Get the next field_index for this document
  const { data: maxIndex } = await supabase
    .from("extracted_fields")
    .select("field_index")
    .eq("document_id", field.document_id)
    .order("field_index", { ascending: false })
    .limit(1)
    .single();

  const nextIndex = (maxIndex?.field_index ?? -1) + 1;

  const { data, error } = await supabase
    .from("extracted_fields")
    .insert({
      ...field,
      field_index: nextIndex,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create field: ${error.message}`);
  }

  return data as ExtractedField;
}

// Page image operations
export async function uploadPageImage(
  userId: string,
  documentId: string,
  pageNumber: number,
  imageData: ArrayBuffer
): Promise<string> {
  const supabase = createAdminClient();
  const storagePath = `${userId}/${documentId}/pages/page-${pageNumber}.png`;

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, imageData, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload page image: ${error.message}`);
  }

  console.log("[AutoForm] Page image uploaded:", {
    documentId,
    pageNumber,
    storagePath,
  });

  return storagePath;
}

export async function getPageImageUrl(storagePath: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour expiry

  if (error || !data) {
    throw new Error(`Failed to get page image URL: ${error?.message}`);
  }

  return data.signedUrl;
}

export async function getPageImageBase64(storagePath: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download page image: ${error?.message}`);
  }

  const buffer = await data.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// Update document page images
export async function updateDocumentPageImages(
  documentId: string,
  pageImages: Array<{ page: number; storage_path: string }>
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("documents")
    .update({
      page_images: pageImages,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to update page images: ${error.message}`);
  }
}

// Upload composite image (page with field overlays) to storage
export async function uploadCompositeImage(
  userId: string,
  documentId: string,
  pageNumber: number,
  imageBase64: string
): Promise<string> {
  const supabase = createAdminClient();
  const storagePath = `${userId}/${documentId}/composites/page-${pageNumber}-composite.png`;

  const imageBuffer = Buffer.from(imageBase64, "base64");

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload composite image: ${error.message}`);
  }

  console.log("[AutoForm] Composite image uploaded:", {
    documentId,
    pageNumber,
    storagePath,
  });

  return storagePath;
}

// Get composite image URL
export async function getCompositeImageUrl(storagePath: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (error || !data) {
    throw new Error(`Failed to get composite image URL: ${error?.message}`);
  }

  return data.signedUrl;
}
