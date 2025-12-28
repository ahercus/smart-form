// Coordinate system - all values are percentages (0-100) relative to page dimensions
export interface NormalizedCoordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Processing phases for parallel pipeline
// Flow: idle → parsing → displaying → enhancing → ready
export type ProcessingPhase =
  | "idle"
  | "parsing"      // Document AI extracting fields
  | "displaying"   // Fields shown to user (editable), questions being generated
  | "enhancing"    // Gemini Vision QC running in background
  | "ready"        // All done
  | "failed";

// Memory choice option (for memory-driven multiple choice questions)
export interface MemoryChoice {
  label: string;
  values: Record<string, string>; // fieldLabel -> value mapping
}

// Question that maps to PDF fields
export interface QuestionGroup {
  id: string;
  document_id: string;
  question: string;
  field_ids: string[];
  input_type: FieldType;
  profile_key?: string;
  page_number: number;
  status: "pending" | "visible" | "answered" | "hidden";
  answer?: string;
  choices?: MemoryChoice[]; // Memory-driven choices for memory_choice type
  created_at: string;
  updated_at: string;
}

// Processing progress (stored in Supabase, pushed via Realtime)
export interface ProcessingProgress {
  phase: ProcessingPhase;
  pagesTotal: number;
  pagesComplete: number;
  questionsDelivered: number;
  currentPage?: number;
  error?: string;
}

// Gemini conversation message for context across pages
export interface GeminiMessage {
  role: "user" | "model";
  content: string;
  pageNumber?: number;
  timestamp: string;
}

// Auto-answered field from Gemini
export interface AutoAnsweredField {
  fieldId: string;
  value: string;
  reasoning: string;
}

// Skipped field from Gemini
export interface SkippedField {
  fieldId: string;
  reason: string;
}

// Gemini question generation response
export interface QuestionGenerationResult {
  questions: Array<{
    question: string;
    fieldIds: string[];
    inputType: FieldType;
    profileKey?: string;
    choices?: MemoryChoice[];
  }>;
  autoAnswered: AutoAnsweredField[];
  skippedFields: SkippedField[];
}

// Field types supported by the system
export type FieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "radio"
  | "date"
  | "signature"
  | "initials"
  | "memory_choice"
  | "unknown";

// Signature type (signature vs initials)
export type SignatureType = "signature" | "initials";

// Detection source for fields
export type DetectionSource = "document_ai" | "azure_document_intelligence" | "gemini_refinement" | "gemini_vision" | "manual";

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

// Signature stored in database (macOS Preview-style)
export interface Signature {
  id: string;
  user_id: string;
  name: string;
  storage_path: string;
  preview_data_url: string | null; // Base64 thumbnail for instant display
  is_default: boolean;
  type: SignatureType; // 'signature' or 'initials'
  created_at: string;
  updated_at: string;
}

// Legacy signature reference stored in profile (deprecated, use Signature table)
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
  context_submitted: boolean;
  fields_qc_complete: boolean; // True when Gemini QC has refined fields
  tailored_context_question: string | null; // AI-generated context question based on document
  use_memory: boolean; // Whether to use saved memories for auto-fill
  extraction_response: unknown | null; // Azure Document Intelligence response
  gemini_refinement_response: unknown | null;
  page_images: PageImage[];
  created_at: string;
  updated_at: string;
  // Optional field completion stats (populated on dashboard)
  total_fields?: number;
  filled_fields?: number;
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
