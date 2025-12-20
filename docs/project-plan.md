# AutoForm AI — Product Requirements Document

## 1. Product Overview

**AutoForm AI** transforms static PDF forms into intelligent, interactive experiences. Users upload any PDF form (native, flat, or scanned), and the system identifies all input fields, presents them in a clean wizard interface, and auto-populates values from the user's saved profile. The result is a filled, downloadable PDF in under 60 seconds.

This is the Typeform for PDFs. We take the friction out of paperwork.

---

## 2. Architecture Principles

These principles govern every technical decision. They are non-negotiable.

### 2.1 Separation of Concerns

Every feature follows a clear separation:

```
feature/
├── page.tsx              # Route + orchestration only (50-100 lines max)
├── components/           # UI components (one per file, rendering only)
├── hooks/                # State management, effects, API calls
├── lib/                  # Pure functions, types, constants
└── api/                  # Server-side routes
```

**What goes where:**

- **page.tsx**: Imports and renders. No business logic. No API calls. Just orchestration.
- **components/**: React components that receive props and render UI. No internal state beyond UI concerns (hover, focus, etc.).
- **hooks/**: Custom hooks that encapsulate logic. All `useState`, `useEffect`, API calls, and complex state machines live here.
- **lib/**: TypeScript types, helper functions, constants. Pure functions only. No React.
- **api/**: Next.js API routes. Server-side logic, external API calls, database operations.

### 2.2 File Size Guidelines

These are signals, not rules:

| File Type | Comfortable | Refactor Signal |
|-----------|-------------|-----------------|
| page.tsx | ~50-100 lines | >150 lines |
| Components | ~200 lines | >400 lines |
| Hooks | ~150 lines | >300 lines |
| API routes | ~100 lines | >200 lines |

If a file exceeds these thresholds, extract logic into separate files. A well-organized codebase is easier to debug, test, and extend.

### 2.3 Error Handling Standards

Every async operation must handle:

1. **Loading states**: UI feedback while operations are in progress
2. **Success states**: Clear confirmation of completed actions
3. **Error states**: User-friendly messages with recovery paths
4. **Empty states**: Graceful handling when no data exists

```typescript
// Example pattern for all async operations
type AsyncState<T> = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string; retry: () => void };
```

### 2.4 Type Safety

- All data structures have TypeScript interfaces
- No `any` types except in genuinely dynamic scenarios
- API responses are validated at the boundary
- Database queries return typed results

### 2.5 Logging Strategy

All significant operations include structured logging:

```typescript
const LOG_PREFIX = '[AutoForm]';

// State changes
console.log(`${LOG_PREFIX} Document status:`, { 
  id: document.id,
  status: 'processing',
  timestamp: Date.now()
});

// API boundaries
console.log(`${LOG_PREFIX} Gemini API started:`, { 
  operation: 'field-refinement',
  pageCount: document.pages.length
});

// Errors with context
console.error(`${LOG_PREFIX} Parse failed:`, error, {
  documentId,
  fileType,
  fileSize
});
```

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Next.js 16 (App Router) | Turbopack default, Cache Components, React 19.2 support |
| Language | TypeScript (strict mode) | Type safety across the stack |
| Styling | Tailwind CSS + shadcn/ui | Consistent design system, accessible components, minimal custom CSS |
| Database | Supabase (PostgreSQL) | Row-level security, real-time subscriptions, excellent DX |
| Auth | Supabase Auth | Integrated with database, supports OAuth providers |
| Storage | Supabase Storage | Private buckets for PDFs, public buckets for rendered pages |
| Deployment | Vercel | Optimized for Next.js, edge functions, preview deployments |
| PDF Rendering | react-pdf (pdf.js) | Client-side PDF display |
| PDF Manipulation | pdf-lib | Server-side text placement and export |
| Field Detection | Azure Document Intelligence | Layout model with keyValuePairs for form fields, checkboxes, bounding boxes |
| AI Processing | Gemini 3 | Field refinement, smart filling, contextual assistance |

### 3.1 shadcn/ui Philosophy

shadcn/ui is the primary component library. Use it heavily for consistency:

- **All form inputs**: Input, Textarea, Checkbox, RadioGroup, Select, DatePicker
- **Layout**: Card, Tabs, Sheet, Drawer, Dialog, ScrollArea
- **Feedback**: Badge, Progress, Skeleton, Toast
- **Navigation**: Button, DropdownMenu

**Do not create custom components** when shadcn provides an equivalent. Customization happens through Tailwind classes on shadcn primitives, not through new components. This ensures visual consistency and reduces maintenance burden.

**Exception:** SignaturePad requires a custom canvas implementation, but should be wrapped in a shadcn Dialog.

---

## 4. Core User Flow

### Step 1: Upload

User drags a PDF onto the upload zone (or uses camera capture on mobile).

**Parallel operations on drop:**
1. File uploads to Supabase Storage (`documents` bucket)
2. User sees a context input: *"Add any notes (optional)"* with placeholder text
3. Document record created in database with status `uploading`

**Context input examples:**
- "This is for my daughter Emma, age 7, allergic to peanuts"
- "Use my business address, not home"
- "Sign with my formal signature"

### Step 2: Processing

**Pipeline (server-side):**

1. **Azure Document Intelligence Analysis**
   - Send PDF to Azure Document Intelligence (prebuilt-layout with keyValuePairs)
   - Receive: key-value pairs with bounding polygons, including empty fillable fields
   - Store raw response in `documents.extraction_response` (cached for cost reduction)

2. **Field Extraction**
   - Parse Azure response keyValuePairs into candidate fields
   - Map bounding polygons to normalized coordinates (0-100 percentages)
   - Generate initial `extracted_fields` records

3. **Gemini Refinement** (the intelligence layer)
   - Send page image + extracted fields JSON to Gemini 3 Vision
   - Prompt: "Review these detected form fields. Identify any that are misaligned, missing, or incorrectly typed. Return corrections."
   - Apply Gemini's corrections to field coordinates and types
   - This is the "good to great" layer that handles edge cases Document AI misses

4. **Status Update**
   - Update document status to `ready`
   - Notify client via polling or webhook

**Processing states:**
- `uploading` → `analyzing` → `extracting` → `refining` → `ready`
- Any failure → `failed` with error details

### Step 3: Wizard View (Primary Interface)

User lands on the **Wizard View** by default. This is a vertical list of form fields, each rendered as a card.

**Field card anatomy:**
```
┌─────────────────────────────────────────┐
│  Patient Full Name                    ⓘ │
│  ┌─────────────────────────────────────┐│
│  │ [text input]                        ││
│  └─────────────────────────────────────┘│
│  ✨ Suggested: "Emma Johnson"    [Use]  │
└─────────────────────────────────────────┘
```

**Components:**
- Label (from Document AI + Gemini refinement)
- Input (type based on field classification)
- Info icon → contextual popover with field explanation
- AI suggestion badge (when Magic Fill has a value)

**Field types rendered:**
| Detected Type | UI Component |
|---------------|--------------|
| text | `<Input />` |
| textarea | `<Textarea />` |
| checkbox | `<Checkbox />` |
| radio | `<RadioGroup />` |
| date | `<DatePicker />` |
| signature | `<SignatureField />` (opens modal) |

### Step 4: Magic Fill

User clicks the **"✨ Auto-Fill"** button.

**Gemini receives:**
```json
{
  "user_profile": {
    "name": "Sarah Johnson",
    "address": "123 Main St, Nashville, TN 37201",
    "phone": "(615) 555-1234",
    "email": "sarah@email.com",
    "children": [
      { "name": "Emma", "age": 7, "allergies": ["peanuts"] }
    ]
  },
  "context_notes": "This is for my daughter Emma, age 7, allergic to peanuts",
  "fields": [
    { "id": "field_1", "label": "Patient Full Name", "type": "text" },
    { "id": "field_2", "label": "Date of Birth", "type": "date" },
    { "id": "field_3", "label": "Known Allergies", "type": "textarea" }
  ]
}
```

**Gemini returns:**
```json
{
  "suggestions": [
    { "field_id": "field_1", "value": "Emma Johnson", "confidence": 0.95 },
    { "field_id": "field_2", "value": "2018-03-15", "confidence": 0.85 },
    { "field_id": "field_3", "value": "Peanut allergy", "confidence": 0.92 }
  ],
  "missing_info": [
    { "field_id": "field_7", "label": "Insurance Policy Number", "question": "What is Emma's insurance policy number?" }
  ]
}
```

**UI behavior:**
- High-confidence suggestions auto-populate with a "suggested" badge
- User can accept (click "Use") or override by typing
- Missing info triggers a **focused dialog**: one question at a time, not a chat

### Step 5: Missing Info Dialog

When Gemini can't fill a field, the user sees a simple dialog:

```
┌─────────────────────────────────────────┐
│  I need one more thing                  │
│                                         │
│  What is Emma's insurance policy        │
│  number?                                │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ [text input]                        ││
│  └─────────────────────────────────────┘│
│                                         │
│  ☐ Save to my profile for next time    │
│                                         │
│              [Continue]                 │
└─────────────────────────────────────────┘
```

**Key UX decisions:**
- One question per dialog (not a form, not a chat)
- Clear, human-readable question (Gemini generates this)
- Option to save to profile (reduces friction on future forms)
- "Continue" moves to the next missing field or closes

### Step 6: Verification View (Secondary)

User can toggle to **"View Original"** tab to see the PDF with positioned inputs overlaid.

**Purpose:** Visual verification that fields are mapped correctly.

**Implementation:** Percentage-based positioning (see Section 6).

This is not the primary editing interface. It's for verification and edge cases where the user wants to see context.

### Step 7: Export

User clicks **"Download PDF"**.

**Server-side process:**
1. Fetch original PDF from Supabase Storage
2. Load with pdf-lib
3. For each field with a value:
   - Convert percentage coordinates back to absolute positions
   - Draw text at coordinates using `page.drawText()`
   - Draw signature images using `page.drawImage()`
4. Flatten form (optional, makes non-editable)
5. Return as downloadable blob

**Export options:**
- Download as PDF
- Print directly
- (Future: Email, Google Drive, Dropbox integrations)

---

## 5. Contextual Help System

**No chatbot.** Users don't want to type "what does AGI mean" into a chat window while filling out a form. They want instant, contextual answers.

**Implementation: Info Popovers**

Every field label has an info icon (ⓘ). On click/tap:

```
┌─────────────────────────────────────────┐
│  Adjusted Gross Income (AGI)            │
│                                         │
│  Your total income minus specific       │
│  deductions. Find this on Line 11 of    │
│  your 2024 Form 1040.                   │
│                                         │
│  📎 Common locations:                   │
│  • Tax return (Form 1040, Line 11)      │
│  • Tax software summary page            │
│                                         │
└─────────────────────────────────────────┘
```

**How it works:**
- On first load of document, Gemini pre-generates explanations for all field labels
- Stored in `extracted_fields.help_text`
- Popovers are instant (no loading spinner)
- Explanations are contextual to the form type (medical vs. tax vs. school)

---

## 6. Coordinate Mapping System

The core technical challenge: translating Document AI's coordinates to responsive CSS.

### The Problem

Document AI returns coordinates in points/pixels relative to the original document size. Our UI renders at variable sizes (desktop, tablet, mobile). Inputs must stay perfectly aligned regardless of viewport.

### The Solution: Percentage-Based Positioning

All coordinates are stored and rendered as percentages relative to the page container.

**Conversion function:**

```typescript
interface RawCoordinates {
  x: number;      // Pixels from left
  y: number;      // Pixels from top
  width: number;  // Pixels wide
  height: number; // Pixels tall
  pageWidth: number;
  pageHeight: number;
}

interface NormalizedCoordinates {
  left: number;   // Percentage (0-100)
  top: number;    // Percentage (0-100)
  width: number;  // Percentage (0-100)
  height: number; // Percentage (0-100)
}

function normalizeCoordinates(raw: RawCoordinates): NormalizedCoordinates {
  return {
    left: (raw.x / raw.pageWidth) * 100,
    top: (raw.y / raw.pageHeight) * 100,
    width: (raw.width / raw.pageWidth) * 100,
    height: (raw.height / raw.pageHeight) * 100,
  };
}
```

**Rendering:**

```tsx
function FieldOverlay({ field }: { field: ExtractedField }) {
  const style = {
    position: 'absolute' as const,
    left: `${field.coordinates.left}%`,
    top: `${field.coordinates.top}%`,
    width: `${field.coordinates.width}%`,
    height: `${field.coordinates.height}%`,
  };

  return (
    <Input
      style={style}
      className="bg-white/50 border-transparent focus:bg-white focus:border-blue-500"
      value={field.value}
      onChange={(e) => updateField(field.id, e.target.value)}
    />
  );
}
```

**Why this works:**
- Parent container is `position: relative` with the PDF image
- Image scales naturally with `width: 100%`
- Absolute-positioned inputs use percentages, so they scale proportionally
- No recalculation needed on resize or zoom

---

## 7. Database Schema

### `profiles`

User account and saved data.

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  
  -- Saved profile data for auto-fill
  core_data jsonb default '{}',
  -- {
  --   "name": "Sarah Johnson",
  --   "address": { "street": "123 Main St", "city": "Nashville", ... },
  --   "phone": "(615) 555-1234",
  --   "email": "sarah@email.com",
  --   "date_of_birth": "1986-05-12"
  -- }
  
  -- Unstructured context for Gemini
  extended_context text,
  -- "I have two children: Emma (7) and Jack (4). Emma has a peanut allergy.
  --  My employer is Acme Corp. My insurance provider is BlueCross, policy #BC123456."
  
  -- Saved signatures (references to storage)
  signatures jsonb default '[]',
  -- [{ "id": "sig_1", "name": "Formal", "storage_path": "signatures/user_123/formal.png" }]
  
  -- Account settings
  subscription_tier text default 'free' check (subscription_tier in ('free', 'pro', 'team')),
  stripe_customer_id text,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: Users can only access their own profile
alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = user_id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = user_id);
```

### `documents`

Uploaded PDF records.

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  
  -- File info
  original_filename text not null,
  storage_path text not null,           -- Path in Supabase Storage
  file_size_bytes integer,
  page_count integer,
  
  -- Processing state
  status text default 'uploading' check (status in (
    'uploading', 'analyzing', 'extracting', 'refining', 'ready', 'failed'
  )),
  error_message text,                   -- Populated if status = 'failed'
  
  -- User-provided context
  context_notes text,                   -- "This is for my daughter Emma..."
  
  -- Cached API responses (for cost reduction)
  extraction_response jsonb,            -- Raw Azure Document Intelligence output
  gemini_refinement_response jsonb,     -- Raw Gemini corrections
  
  -- Rendered page images (for overlay view)
  page_images jsonb default '[]',       -- [{ "page": 1, "storage_path": "..." }]
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: Users can only access their own documents
alter table documents enable row level security;

create policy "Users can view own documents"
  on documents for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on documents for update
  using (auth.uid() = user_id);
```

### `extracted_fields`

Individual form fields detected in documents.

```sql
create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  
  -- Field identification
  page_number integer not null,
  field_index integer not null,         -- Order within page
  
  -- Label and type
  label text not null,                  -- "Patient Full Name", "Date of Birth"
  field_type text not null check (field_type in (
    'text', 'textarea', 'checkbox', 'radio', 'date', 'signature', 'unknown'
  )),
  
  -- Position (percentage-based)
  coordinates jsonb not null,
  -- { "left": 10.5, "top": 25.2, "width": 30.0, "height": 3.5 }
  
  -- Values
  value text,                           -- User's input (or accepted suggestion)
  ai_suggested_value text,              -- Gemini's suggestion
  ai_confidence float,                  -- 0.0 - 1.0
  
  -- Help content
  help_text text,                       -- Pre-generated explanation for info popover
  
  -- Metadata
  detection_source text default 'azure_document_intelligence' check (detection_source in (
    'azure_document_intelligence', 'gemini_refinement', 'gemini_vision', 'manual'
  )),
  confidence_score float,               -- Document AI's detection confidence
  manually_adjusted boolean default false,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(document_id, page_number, field_index)
);

-- RLS: Access through parent document
alter table extracted_fields enable row level security;

create policy "Users can view fields for own documents"
  on extracted_fields for select
  using (
    exists (
      select 1 from documents
      where documents.id = extracted_fields.document_id
      and documents.user_id = auth.uid()
    )
  );

create policy "Users can update fields for own documents"
  on extracted_fields for update
  using (
    exists (
      select 1 from documents
      where documents.id = extracted_fields.document_id
      and documents.user_id = auth.uid()
    )
  );
```

### Indexes

```sql
-- Fast document lookups by user
create index idx_documents_user_id on documents(user_id);
create index idx_documents_status on documents(status);

-- Fast field lookups by document
create index idx_extracted_fields_document_id on extracted_fields(document_id);
create index idx_extracted_fields_page on extracted_fields(document_id, page_number);
```

---

## 8. API Routes

### `POST /api/documents/upload`

Handles file upload and initiates processing.

**Request:**
- Multipart form data with PDF file
- Optional `context_notes` field

**Response:**
```json
{
  "document_id": "uuid",
  "status": "uploading",
  "message": "Document received. Processing will begin shortly."
}
```

**Flow:**
1. Validate file (PDF, size limits)
2. Upload to Supabase Storage
3. Create document record
4. Trigger processing pipeline (async)
5. Return immediately with document ID

### `POST /api/documents/[id]/process`

Internal route triggered after upload. Handles the full processing pipeline.

**Steps:**
1. Update status to `analyzing`
2. Call Azure Document Intelligence
3. Update status to `extracting`
4. Parse response, create extracted_fields records
5. Update status to `refining`
6. Call Gemini for refinement
7. Apply corrections
8. Generate help text for all fields
9. Update status to `ready`

**Error handling:**
- Any failure updates status to `failed` with error_message
- Partial progress is preserved (e.g., if Gemini fails, Azure results remain)

### `GET /api/documents/[id]`

Returns document with all fields.

**Response:**
```json
{
  "id": "uuid",
  "status": "ready",
  "original_filename": "patient_intake.pdf",
  "page_count": 2,
  "context_notes": "For my daughter Emma...",
  "fields": [
    {
      "id": "field_uuid",
      "page_number": 1,
      "label": "Patient Full Name",
      "field_type": "text",
      "coordinates": { "left": 10.5, "top": 25.2, "width": 30.0, "height": 3.5 },
      "value": null,
      "ai_suggested_value": "Emma Johnson",
      "ai_confidence": 0.95,
      "help_text": "Enter the patient's legal full name as it appears on their ID."
    }
  ],
  "page_images": [
    { "page": 1, "url": "https://..." }
  ]
}
```

### `PATCH /api/documents/[id]/fields`

Batch update field values.

**Request:**
```json
{
  "updates": [
    { "field_id": "uuid", "value": "Emma Johnson" },
    { "field_id": "uuid", "value": "2018-03-15" }
  ]
}
```

**Response:**
```json
{
  "updated": 2,
  "fields": [...]
}
```

### `POST /api/documents/[id]/autofill`

Triggers Gemini auto-fill.

**Request:**
```json
{
  "use_profile": true,
  "additional_context": "Use my business address"
}
```

**Response:**
```json
{
  "suggestions": [
    { "field_id": "uuid", "value": "Emma Johnson", "confidence": 0.95 }
  ],
  "missing_info": [
    { "field_id": "uuid", "label": "Insurance Policy Number", "question": "What is Emma's insurance policy number?" }
  ]
}
```

### `POST /api/documents/[id]/export`

Generates filled PDF.

**Request:**
```json
{
  "flatten": true,
  "format": "pdf"
}
```

**Response:**
- Content-Type: application/pdf
- Binary PDF data

---

## 9. Component Structure

### Application Layout

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── signup/page.tsx
├── (dashboard)/
│   ├── layout.tsx              # Authenticated layout with nav
│   ├── page.tsx                # Dashboard home (recent documents)
│   └── profile/page.tsx        # Profile settings, saved data
├── document/
│   └── [id]/
│       ├── page.tsx            # Document view orchestration
│       ├── components/
│       │   ├── DocumentTabs.tsx
│       │   ├── WizardView.tsx
│       │   ├── OverlayView.tsx
│       │   ├── FieldCard.tsx
│       │   ├── FieldInput.tsx
│       │   ├── SignaturePad.tsx
│       │   ├── MissingInfoDialog.tsx
│       │   ├── ExportButton.tsx
│       │   └── ProcessingStatus.tsx
│       ├── hooks/
│       │   ├── useDocument.ts
│       │   ├── useFieldUpdates.ts
│       │   ├── useAutoFill.ts
│       │   └── useExport.ts
│       └── lib/
│           ├── types.ts
│           └── coordinates.ts
├── api/
│   ├── documents/
│   │   ├── upload/route.ts
│   │   └── [id]/
│   │       ├── route.ts
│   │       ├── process/route.ts
│   │       ├── fields/route.ts
│   │       ├── autofill/route.ts
│   │       └── export/route.ts
│   └── profile/route.ts
└── components/                 # Shared components
    ├── ui/                     # shadcn components
    ├── UploadZone.tsx
    ├── ContextInput.tsx
    └── LoadingStates.tsx
```

### Key Components

**WizardView.tsx**
- Vertical scroll of FieldCard components
- Keyboard navigation (Tab to next field)
- Progress indicator (X of Y fields completed)

**FieldCard.tsx**
- Renders appropriate input based on field_type
- Shows AI suggestion badge when available
- Info icon with popover for help_text
- Handles value updates via useFieldUpdates hook

**OverlayView.tsx**
- PDF page rendered as image
- Absolute-positioned inputs using percentage coordinates
- Zoom controls (optional)
- Visual verification, not primary editing

**SignaturePad.tsx**
- Modal with canvas for drawing
- Clear / Cancel / Save actions
- Converts to PNG, uploads to storage
- Returns storage path for embedding in PDF

**MissingInfoDialog.tsx**
- Single-question dialog (not a form)
- Shows Gemini's generated question
- Optional "Save to profile" checkbox
- Advances through missing fields sequentially

---

## 10. Gemini Integration Patterns

### Pattern 1: Field Refinement (Vision)

**When:** After Document AI extraction, before showing to user

**Input:**
- Page image (rendered from PDF)
- Extracted fields JSON from Document AI

**Prompt:**
```
You are reviewing form field detection results. 

Here is a form page image and the detected fields:

[IMAGE]

Detected fields:
[JSON array of fields with coordinates]

Review each field and identify:
1. Fields with incorrect bounding boxes (misaligned, too small, too large)
2. Fields that were missed entirely
3. Fields that were incorrectly classified (e.g., checkbox detected as text)

Return corrections in this format:
{
  "corrections": [
    { "field_index": 0, "issue": "misaligned", "corrected_coordinates": {...} },
    { "field_index": null, "issue": "missing", "label": "Signature", "type": "signature", "coordinates": {...} }
  ],
  "type_corrections": [
    { "field_index": 3, "original_type": "text", "corrected_type": "checkbox" }
  ]
}
```

### Pattern 2: Smart Fill (Text)

**When:** User clicks "Auto-Fill"

**Input:**
- User profile (core_data + extended_context)
- Document context_notes
- Array of field labels and types

**Prompt:**
```
You are filling out a form on behalf of a user.

User Profile:
{JSON}

Additional Context:
"{context_notes}"

Form Fields:
{JSON array of { id, label, type }}

For each field, determine the appropriate value from the user's profile and context.

Return:
{
  "suggestions": [
    { "field_id": "...", "value": "...", "confidence": 0.95, "reasoning": "..." }
  ],
  "missing_info": [
    { 
      "field_id": "...", 
      "label": "...", 
      "question": "What is [specific human-readable question]?",
      "why_needed": "This form requires..."
    }
  ]
}

Rules:
- Only suggest values you're confident about
- For missing info, write clear, conversational questions
- Consider the context notes when interpreting ambiguous fields
- If a field asks for a child's info and context mentions a specific child, use that child's data
```

### Pattern 3: Help Text Generation (Text)

**When:** During processing, after fields are extracted

**Input:**
- Field label
- Form type/context (inferred from document)
- Surrounding field labels (for context)

**Prompt:**
```
Generate a brief, helpful explanation for this form field.

Field: "{label}"
Form appears to be: {inferred_type} (medical intake, tax form, school registration, etc.)
Surrounding fields: {nearby_labels}

Write 2-3 sentences explaining:
1. What this field is asking for
2. Where to find this information (if applicable)

Keep it conversational and helpful. No jargon.
```

---

## 11. Mobile Experience

Mobile is not an afterthought. Screen space is at a massive premium. Every pixel must earn its place.

### 11.1 Mobile-First Component Choices

| Desktop Component | Mobile Equivalent | Rationale |
|-------------------|-------------------|-----------|
| Sidebar | `Drawer` (bottom sheet) | Full-width, thumb-reachable |
| Modal/Dialog | `Drawer` (bottom sheet) | Easier to dismiss, more natural on mobile |
| Tabs | Swipeable views or `Drawer` with menu | Horizontal tabs waste vertical space |
| Hover tooltips | Tap-to-reveal popovers | No hover on touch |
| Multi-column layouts | Single column, stacked | Screen width is ~375px |

### 11.2 Wizard View on Mobile

The wizard is the primary mobile interface. Optimizations:

**Single-field focus mode:**
- Each field card takes full viewport height minus header/footer
- Swipe left/right to navigate between fields (or tap Next/Previous)
- Progress indicator shows X of Y (compact, top of screen)
- Keyboard auto-opens for text fields

**Sticky action bar (bottom):**
```
┌─────────────────────────────────────────┐
│  [← Prev]     3 of 12     [Next →]      │
│                                         │
│  [✨ Auto-Fill]           [Download]    │
└─────────────────────────────────────────┘
```

**Field card on mobile:**
```
┌─────────────────────────────────────────┐
│  Patient Full Name              [ⓘ] [⋮] │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  │  [Large touch-friendly input]       ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  ✨ Suggestion: "Emma Johnson"   [Use]  │
│                                         │
└─────────────────────────────────────────┘
```

The `[⋮]` menu (kebab) opens a bottom Drawer with field actions (see 11.5).

### 11.3 Overlay View on Mobile

The overlay view is secondary on mobile but still necessary for verification.

**Gestures:**
- Pinch to zoom (required, users will need to see detail)
- Pan to navigate zoomed view
- Double-tap to zoom to 100% on a specific area
- Tap on a field to edit (opens Drawer with input)

**Editing in overlay:**
- Tapping a field does NOT show inline input (too small)
- Instead, opens a bottom `Drawer` with the field label, input, and keyboard
- Drawer includes "Previous" and "Next" buttons to move between fields without closing

### 11.4 Camera Capture

On mobile, the upload zone includes a camera option:

```tsx
<UploadZone
  onFileSelect={handleFile}
  onCameraCapture={handleCamera}
  accept=".pdf,image/*"
/>
```

**Camera flow:**
1. User taps "Take Photo" or camera icon
2. Native camera opens (use `<input type="file" capture="environment">`)
3. User photographs paper form
4. Image is sent to Document AI (handles scanned documents)
5. Same processing pipeline from there

**Multi-page capture:**
- After first photo, prompt: "Add another page?" with [Done] and [+ Add Page] buttons
- Pages are stitched into a single document for processing

### 11.5 Manual Field Controls

These controls exist for edge cases. If AI does its job well, they're rarely used. But their absence causes catastrophic frustration when needed.

**KPI:** Track usage of manual controls. Target: <5% of sessions require manual field adjustment. If higher, improve AI detection.

#### 11.5.1 Manual Field Editing

Every field value can be manually edited. This is the default interaction:
- In Wizard view: Type directly into the input
- In Overlay view: Tap field → Drawer opens → Type → Save
- AI suggestions are just suggestions. User can always override.

#### 11.5.2 Field Repositioning (Move)

Users can adjust field position if AI got coordinates wrong.

**Desktop:**
- In Overlay view, hold `Option/Alt` + click and drag field to new position
- Or: Click field → Floating toolbar appears → Click "Move" icon → Drag

**Mobile:**
- In Overlay view, long-press field (500ms) to enter "edit mode"
- Drag handles appear on corners
- Drag field to new position
- Tap outside to confirm

**Implementation:**
```typescript
interface FieldAdjustment {
  field_id: string;
  original_coordinates: NormalizedCoordinates;
  adjusted_coordinates: NormalizedCoordinates;
  adjustment_type: 'move' | 'resize';
  timestamp: string;
}

// Store adjustments in extracted_fields.manually_adjusted = true
// Update coordinates in extracted_fields.coordinates
```

#### 11.5.3 Field Resizing

Users can adjust field size if AI got dimensions wrong.

**Desktop:**
- In Overlay view, click field → Drag corner handles to resize

**Mobile:**
- Long-press to enter edit mode → Drag corner handles

#### 11.5.4 Add Field

Users can add fields that AI missed entirely.

**Desktop:**
- In Overlay view, click "Add Field" button in toolbar
- Click and drag to draw a rectangle where the field should be
- Dialog appears: "What type of field is this?" (text, checkbox, signature, etc.)
- Optionally enter a label, or leave blank

**Mobile:**
- Tap `[+]` button in bottom action bar
- Enters "draw mode" with crosshair cursor
- Tap and drag to create field rectangle
- Bottom Drawer appears with field type selection and label input

**Implementation:**
```typescript
// New field with detection_source = 'manual'
const newField: ExtractedField = {
  id: generateUUID(),
  document_id: document.id,
  page_number: currentPage,
  field_index: fields.length + 1,
  label: userProvidedLabel || 'Custom Field',
  field_type: selectedType,
  coordinates: drawnCoordinates,
  detection_source: 'manual',
  manually_adjusted: false, // It's new, not adjusted
  confidence_score: 1.0, // User-created = 100% confidence
};
```

#### 11.5.5 Delete Field

Users can remove fields that shouldn't exist (false positives from AI).

**Desktop:**
- In Wizard view: Click `[⋮]` menu on field card → "Delete field"
- In Overlay view: Click field → Press `Delete` key or click trash icon in toolbar

**Mobile:**
- In Wizard view: Tap `[⋮]` menu → Bottom Drawer with "Delete field" option
- In Overlay view: Long-press field → Tap trash icon in floating toolbar

**Confirmation:**
- Always show confirmation: "Delete this field? This cannot be undone."
- Use shadcn `AlertDialog` for confirmation

**Implementation:**
- Soft delete: Set `extracted_fields.deleted_at` timestamp
- Don't hard delete until document is exported (allows undo during session)

### 11.6 Drawer Patterns (shadcn Sheet)

Use `Sheet` component from shadcn for all mobile drawers. Configure:

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button variant="ghost" size="icon">
      <MoreVertical className="h-4 w-4" />
    </Button>
  </SheetTrigger>
  <SheetContent side="bottom" className="h-[50vh]">
    <SheetHeader>
      <SheetTitle>Field Options</SheetTitle>
    </SheetHeader>
    {/* Content */}
  </SheetContent>
</Sheet>
```

**Drawer height guidelines:**
- Simple menus (3-5 options): `h-auto` with padding
- Field editing: `h-[50vh]` to leave room for keyboard
- Full forms (missing info): `h-[70vh]`

### 11.7 Touch Target Sizes

Minimum touch targets per WCAG:
- Buttons: 44x44px minimum
- Form inputs: 48px height minimum
- Spacing between tap targets: 8px minimum

Apply via Tailwind:
```tsx
<Button className="min-h-[44px] min-w-[44px]">
<Input className="h-12" />
```

---

## 12. Data Privacy

### Storage Policy

| Data Type | Retention | Encryption |
|-----------|-----------|------------|
| Original PDFs | 30 days | At rest (Supabase default) |
| Filled field values | 30 days | At rest |
| User profile data | Until deleted | At rest |
| Signatures | Until deleted | At rest |

### User Controls

- "Delete this document" removes PDF and all field data immediately
- "Delete my account" removes all user data, documents, and profile
- "Export my data" downloads all stored information as JSON

### API Security

- All routes require authentication (Supabase JWT)
- Row-level security enforces data isolation
- No cross-user data access possible at database level
- File storage uses signed URLs with expiration

---

## 13. Future Extensibility

The architecture supports these planned features without refactoring:

### Payments (v1.1)
- `profiles.subscription_tier` already exists
- `profiles.stripe_customer_id` ready for Stripe integration
- Add `usage_tracking` table for credit system

### Team Accounts (v1.2)
- Add `organizations` table
- Add `organization_members` junction table
- Extend RLS policies for org-level access

### Integrations (v1.3)
- Google Drive export
- Dropbox export
- Email filled PDF
- Add `integrations` table for OAuth tokens

### Templates (v2.0)
- Save filled forms as templates
- Pre-fill common forms (W-9, I-9, etc.)
- Add `templates` table with field mappings

---

## 14. Success Metrics

### Primary Metric
**Time to completion:** Upload to downloaded PDF

- Target: < 60 seconds for forms under 20 fields
- Measure: p50, p90, p99 completion times

### Secondary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Field detection accuracy | > 95% | Fields correctly identified without manual adjustment |
| Auto-fill accuracy | > 85% | Suggested values accepted without edit |
| Processing success rate | > 99% | Documents reaching "ready" status |
| Mobile completion rate | > 80% | Forms completed on mobile vs. abandoned |
| Manual field adjustment rate | < 5% | Sessions requiring move/resize/add/delete |

### Quality Signals

- User returns within 7 days (retention)
- User completes 3+ forms (activation)
- User saves data to profile (engagement)
- User upgrades to Pro (conversion)

### Manual Control Usage (Critical KPI)

Track every manual field operation:
- `field_moved`: User repositioned a field
- `field_resized`: User changed field dimensions
- `field_added`: User created a new field
- `field_deleted`: User removed a field

**Target:** Combined manual adjustment rate < 5% of sessions.

**If this metric exceeds 10%:**
1. Analyze which document types trigger manual adjustments
2. Review Gemini refinement prompts for those document types
3. Consider additional Document AI training or fallback strategies

This is the canary in the coal mine. High manual adjustment rates mean the AI isn't doing its job.

---

## 15. Development Checklist

### Phase 1: Foundation
- [ ] Initialize Next.js 16 project with TypeScript
- [ ] Configure Tailwind + shadcn/ui (install all needed components upfront)
- [ ] Set up Supabase project (database, auth, storage)
- [ ] Create database schema and RLS policies
- [ ] Implement authentication flow
- [ ] Create dashboard layout and navigation

### Phase 2: Upload & Processing
- [ ] Build UploadZone component with drag-and-drop
- [ ] Implement file upload to Supabase Storage
- [ ] Create /api/documents/upload route
- [x] Integrate Azure Document Intelligence
- [ ] Build field extraction logic
- [ ] Integrate Gemini refinement step
- [ ] Implement processing status polling

### Phase 3: Wizard Interface
- [ ] Build WizardView with FieldCard components
- [ ] Implement all field type inputs (text, textarea, checkbox, radio, date)
- [ ] Add keyboard navigation (Tab flow)
- [ ] Create info popovers with help text
- [ ] Build progress indicator
- [ ] Implement field value persistence

### Phase 4: Auto-Fill
- [ ] Build profile settings page
- [ ] Create /api/documents/[id]/autofill route
- [ ] Implement Gemini smart fill prompts
- [ ] Build AI suggestion badges
- [ ] Create MissingInfoDialog component (as bottom Drawer on mobile)
- [ ] Add "Save to profile" functionality

### Phase 5: Signature & Export
- [ ] Build SignaturePad modal (canvas-based)
- [ ] Implement signature storage
- [ ] Create /api/documents/[id]/export route
- [ ] Integrate pdf-lib for text placement
- [ ] Handle signature image embedding
- [ ] Generate downloadable PDF

### Phase 6: Verification View (Overlay)
- [ ] Render PDF pages as images
- [ ] Build OverlayView with positioned inputs
- [ ] Implement percentage-based coordinate system
- [ ] Add zoom controls (pinch-to-zoom on mobile)
- [ ] Sync values between Wizard and Overlay views

### Phase 7: Manual Field Controls
- [ ] Implement field repositioning (drag to move)
- [ ] Implement field resizing (drag handles)
- [ ] Build "Add Field" flow (draw rectangle, select type)
- [ ] Implement field deletion with confirmation
- [ ] Add undo capability for field operations (session-based)
- [ ] Track manual adjustment events for KPI monitoring

### Phase 8: Mobile Optimization
- [ ] Convert dialogs to bottom Drawers on mobile
- [ ] Implement swipe navigation in Wizard view
- [ ] Add camera capture for photo-to-form
- [ ] Implement multi-page photo capture
- [ ] Test and fix touch targets (44px minimum)
- [ ] Implement long-press for field edit mode in Overlay
- [ ] Optimize keyboard behavior for form inputs

### Phase 9: Polish & Testing
- [ ] Add loading states everywhere (use shadcn Skeleton)
- [ ] Implement error boundaries
- [ ] Add empty states
- [ ] Toast notifications for actions (shadcn Toast)
- [ ] Performance optimization (lazy loading, image compression)
- [ ] End-to-end testing with various PDF types
- [ ] Cross-browser testing
- [ ] Mobile device testing (iOS Safari, Android Chrome)

### Phase 10: Launch Prep
- [ ] Security audit
- [ ] Set up monitoring (error tracking, analytics)
- [ ] Implement KPI tracking (manual adjustment rate, completion time)
- [ ] Create demo video (under 3 minutes)
- [ ] Write documentation
- [ ] Deploy to production

---

**END OF DOCUMENT**