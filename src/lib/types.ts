// Coordinate system - all values are percentages (0-100) relative to page dimensions
export interface NormalizedCoordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Field types supported by the system
export type FieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "radio"
  | "date"
  | "signature"
  | "unknown";

// Detection source for fields
export type DetectionSource = "document_ai" | "gemini_refinement" | "manual";

// Document processing status
export type DocumentStatus =
  | "uploading"
  | "analyzing"
  | "extracting"
  | "refining"
  | "ready"
  | "failed";

// Subscription tiers
export type SubscriptionTier = "free" | "pro" | "team";

// Signature reference stored in profile
export interface SignatureReference {
  id: string;
  name: string;
  storage_path: string;
}

// Core profile data for auto-fill
export interface CoreProfileData {
  name?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  phone?: string;
  email?: string;
  date_of_birth?: string;
  [key: string]: unknown; // Allow additional fields
}

// User profile
export interface Profile {
  id: string;
  user_id: string;
  email: string;
  core_data: CoreProfileData;
  extended_context: string | null;
  signatures: SignatureReference[];
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

// Page image reference
export interface PageImage {
  page: number;
  storage_path: string;
  url?: string; // Signed URL for display
}

// Document
export interface Document {
  id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number | null;
  page_count: number | null;
  status: DocumentStatus;
  error_message: string | null;
  context_notes: string | null;
  document_ai_response: unknown | null;
  gemini_refinement_response: unknown | null;
  page_images: PageImage[];
  created_at: string;
  updated_at: string;
}

// Extracted field from a document
export interface ExtractedField {
  id: string;
  document_id: string;
  page_number: number;
  field_index: number;
  label: string;
  field_type: FieldType;
  coordinates: NormalizedCoordinates;
  value: string | null;
  ai_suggested_value: string | null;
  ai_confidence: number | null;
  help_text: string | null;
  detection_source: DetectionSource;
  confidence_score: number | null;
  manually_adjusted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Document with fields (for API responses)
export interface DocumentWithFields extends Document {
  fields: ExtractedField[];
}

// Async state pattern for UI
export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string; retry: () => void };

// Auto-fill suggestion from Gemini
export interface AutoFillSuggestion {
  field_id: string;
  value: string;
  confidence: number;
  reasoning?: string;
}

// Missing info request from Gemini
export interface MissingInfoRequest {
  field_id: string;
  label: string;
  question: string;
  why_needed?: string;
}

// Auto-fill response
export interface AutoFillResponse {
  suggestions: AutoFillSuggestion[];
  missing_info: MissingInfoRequest[];
}

// Field update for batch updates
export interface FieldUpdate {
  field_id: string;
  value: string;
}

// Coordinate conversion utilities
export interface RawCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export function normalizeCoordinates(raw: RawCoordinates): NormalizedCoordinates {
  return {
    left: (raw.x / raw.pageWidth) * 100,
    top: (raw.y / raw.pageHeight) * 100,
    width: (raw.width / raw.pageWidth) * 100,
    height: (raw.height / raw.pageHeight) * 100,
  };
}

export function denormalizeCoordinates(
  normalized: NormalizedCoordinates,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: (normalized.left / 100) * pageWidth,
    y: (normalized.top / 100) * pageHeight,
    width: (normalized.width / 100) * pageWidth,
    height: (normalized.height / 100) * pageHeight,
  };
}
