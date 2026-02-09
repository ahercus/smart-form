# Architecture

## Overview

Fit Form transforms static PDF forms into conversational, auto-filled experiences. Users upload a PDF, and the system extracts every input field using Gemini Vision, corrects their coordinates against deterministic geometry sources, groups them into natural-language questions, and auto-fills answers from an entity memory system that learns across documents. The filled form is exported as a pixel-accurate PDF.

What makes this technically interesting is the hybrid AI + deterministic pipeline. Gemini handles semantic understanding (what is this field? what does this answer mean?) while traditional geometry algorithms handle spatial precision (where exactly is this field?). This separation emerged from benchmarking 24+ model configurations and discovering that LLM field detection accuracy and coordinate accuracy are fundamentally different problems.

## Processing Pipeline

```
                        Upload (PDF or image)
                              │
                    ┌─────────┴──────────┐
                    │                    │
              Image Conversion     AcroForm Extraction
              (if not PDF)         (embedded form fields)
                    │                    │
                    ▼                    │
              Page Rendering             │
                    │                    │
         ┌─────────┴──────────┐          │
         │                    │          │
   Gemini Vision        Geometry Prep    │
   Field Extraction     (parallel)       │
   (~10s/page)          CV lines ~200ms  │
         │              Vectors ~1s      │
         │              OCR snap data    │
         │                    │          │
         └─────────┬──────────┘          │
                   │                     │
                   ▼                     │
         Coordinate Snapping ◄───────────┘
         (AcroForm → OCR → CV → Vector → Rect)
         <10ms, zero added latency
                   │
                   ▼
         Header Filter
         (remove prefilled text via OCR coverage)
                   │
                   ▼
         Table Expansion
         (grid fields → individual cells)
                   │
         ┌─────────┴──────────┐
         │                    │
   Azure OCR            Context Analysis
   (full text)          (Gemini Vision)
   (parallel)           Tailored question
         │                    │
         └─────────┬──────────┘
                   │
                   ▼
         Question Generation
         (Gemini Flash, groups fields by entity)
                   │
                   ▼
         Wizard Interface
         Answer → Parse → Auto-fill → Memory Extract
         (each answer triggers cross-question re-evaluation)
                   │
                   ▼
         PDF Export
         (Konva → PNG overlays → pdf-lib)
```

### Parallel Execution Model

The pipeline uses two parallelism strategies to minimize wall-clock time:

1. **Intra-page parallelism**: Gemini Vision takes ~10 seconds per page. During that wait, CV line detection (~200ms), PDF vector extraction (~1s), and AcroForm parsing run concurrently. By the time Gemini returns, all geometry data is ready. Snapping adds <10ms on top.

2. **Inter-page parallelism**: Multi-page documents process all pages concurrently. Each page runs its own Gemini + geometry pipeline independently.

3. **Context parallelism**: Azure OCR runs in parallel with field extraction. The OCR text is used later for question generation and context analysis but doesn't block the extraction flow.

Source: `src/lib/orchestrator/single-page-extraction/index.ts`

## Gemini Integration

Fit Form makes 7 distinct Gemini API calls per document lifecycle, each serving a different reasoning task. This is a multi-agent orchestration system where each call has a specific prompt, schema, and model configuration tuned to its task.

### 1. Field Extraction (Vision)

**Model**: `gemini-3-flash-preview` | **Thinking**: MINIMAL | **Input**: Page image (1600px)

Detects all input fields on a single page, returning labels, types, and percentage-based coordinates. The prompt (`full_rails_no_rulers`) was selected from 24 benchmark configurations — it achieved the best balance of detection rate (94%) and type accuracy (100%).

The model outputs structured JSON matching a strict response schema that constrains field types to a known set (`text`, `textarea`, `checkbox`, `date`, `signature`, `table`, `linkedDate`, etc.).

Source: `src/lib/gemini/vision/single-page-extract.ts`

### 2. Context Analysis (Vision)

**Model**: `gemini-3-flash-preview` | **Thinking**: MINIMAL | **Input**: First page image

Analyzes the document's first page to generate a tailored context question. Instead of a generic "tell us about yourself," the system asks something specific like "This appears to be a school enrollment form. Who is the student being enrolled?" This runs before field extraction completes to minimize user wait time.

Source: `src/app/api/documents/[id]/analyze-context/route.ts`

### 3. Question Generation

**Model**: `gemini-3-flash-preview` | **Thinking**: MINIMAL | **Input**: All fields + OCR text + memory context

Groups extracted fields into conversational questions organized by detected entity (Student, Parent 1, Parent 2, Emergency Contact, etc.). A form with 40 fields might produce 8-12 questions. The model also identifies fields that can be auto-answered from saved memory and flags fields to skip (decorative elements, section headers).

When entity memory is available, the model receives matching entities and their facts as context, enabling it to generate `memory_choice` input types where the user selects from known entities rather than typing.

Source: `src/lib/gemini/vision/document-questions.ts`

### 4. Answer Parsing

**Model**: `gemini-3-flash-preview` | **Input**: Question + answer + field metadata

Maps a natural language answer to structured field values. A single answer like "John Smith, born March 15 1990, phone is 555-0123" can populate a dozen fields simultaneously. The parser handles:

- Multi-field distribution (one answer → many fields)
- Date formatting with timezone awareness
- Partial answers with follow-up question generation
- Circle choice matching (local, no API call)
- Signature data URIs (passthrough, no API call)

Source: `src/lib/gemini/vision/answers.ts`

### 5. Cross-Question Auto-fill

**Model**: `gemini-3-flash-preview` | **Input**: New answer + all pending questions + field metadata

After each answer, re-evaluates all remaining questions to check if any can now be auto-answered. If the user answered question 3 with information that also satisfies questions 7 and 12, those questions are automatically filled without prompting. Strict entity boundary rules prevent cross-entity inference (e.g., a parent's phone number won't auto-fill the student's phone field).

Source: `src/lib/gemini/vision/answers.ts` (`reevaluatePendingQuestions`)

### 6. Memory Extraction

**Model**: `gemini-3-pro-preview` | **Thinking**: LOW | **Input**: Question + answer + existing entities

Extracts entities (people, places, organizations), their facts (name, birthdate, phone, address), and relationships (parent_of, works_at, lives_at) from each answered question. Uses Pro model instead of Flash because entity/relationship reasoning requires deeper inference.

Sensitive data (SSN, credit card numbers, passwords, etc.) is explicitly filtered post-extraction and never stored. Confidence scores enable corroboration across documents — the same fact from two different forms increases confidence, while contradictory facts trigger conflict resolution.

Source: `src/lib/memory/extraction.ts`

### 7. Voice Transcription

**Model**: `gemini-3-flash-preview` | **Input**: Audio blob + form context

Context-aware speech-to-text. Unlike generic transcription, the model receives the current question and field labels as context, improving accuracy for domain-specific terms (medical terminology, legal terms, proper nouns) that appear on the form.

Source: `src/app/api/transcribe/route.ts`

### Safety Configuration

All Gemini calls disable default safety filters. Form fields contain labels like "Gender," "Race," "Date of Birth," "Social Security Number," and "Medical History" that trigger false positives on content safety classifiers. The application handles sensitive data through its own filtering layer (see Memory System).

## Coordinate Snapping Pipeline

### The Problem

We ran 24 test configurations across models (Flash, Pro), thinking levels (MINIMAL, MEDIUM, LOW, HIGH), architectures (single page, with rulers, quadrant), and prompt styles (minimal, high agency, medium agency, full rails). The results revealed a fundamental insight:

| Metric | Best Configuration |
|--------|--------------------|
| Detection Rate | 100% (Flash MINIMAL, single_page, high_agency) |
| Coordinate IoU | 67% (same configuration) |
| Type Accuracy | 100% |
| Label Accuracy | 94% |

Gemini excels at semantic understanding — identifying what fields exist, what type they are, and what their labels say. But precise pixel-level coordinate regression is a fundamentally different problem. The model consistently places fields in approximately the right location but struggles with exact boundary alignment.

This is not a prompt engineering problem. Across all 24 configurations, the gap between detection accuracy and coordinate accuracy persisted. Increasing thinking time (MINIMAL → MEDIUM) improved detection but did not meaningfully improve IoU. Adding ruler overlays or quadrant-based extraction made things worse.

### The Solution

A hybrid pipeline where Gemini handles semantics (field detection, labeling, typing) and deterministic geometry algorithms handle spatial precision. The coordinate snapping pipeline runs in 6 stages, each targeting a different geometry source:

```
Gemini fields (67% IoU)
        │
  ┌─────▼──────┐
  │ 0. AcroForm │  Perfect coordinates from PDF-embedded form fields
  │    snap     │  (when available — zero-cost fast path)
  └─────┬──────┘
  ┌─────▼──────┐
  │ 1. OCR     │  Push field.left past label right edge
  │    snap    │  (most conservative — left coordinate only)
  └─────┬──────┘
  ┌─────▼──────┐
  │ 2. CV      │  Snap bottom edge to pixel-detected horizontal lines
  │    snap    │  (catches scanned forms with no vector data)
  └─────┬──────┘
  ┌─────▼──────┐
  │ 3. Vector  │  Snap bottom edge to PDF drawing command lines
  │    snap    │  (most precise source for digital forms)
  └─────┬──────┘
  ┌─────▼──────┐
  │ 4. Checkbox│  Snap checkbox/radio to nearest small square rect
  │    snap    │
  └─────┬──────┘
  ┌─────▼──────┐
  │ 5. Textarea│  Snap textarea to nearest large rectangle
  │    snap    │
  └─────┬──────┘
        │
  Snapped fields (79% IoU)
```

Plus a **header filter** that removes fields where OCR text covers >25% of the field area (indicating pre-printed text, not input fields).

### Pipeline Ordering

The snap chain order (AcroForm → OCR → CV → Vector → Checkbox → Textarea) was determined by benchmarking all permutations. Each stage operates independently — a field can be snapped by multiple stages, with later stages refining earlier adjustments.

### Results

| Stage | IoU Improvement | Mechanism |
|-------|-----------------|-----------|
| Baseline (Gemini only) | 67.8% | — |
| + OCR snap | +3.5% | Left edge alignment past labels |
| + CV snap | +9.8% | Bottom edge to pixel lines |
| + Vector snap | +10.4% | Bottom edge to PDF vector lines |
| + Rect snap | varies | Checkbox/textarea bounding boxes |
| **Combined pipeline** | **79.1%** | **+11.3% total, zero regressions** |

Note: CV and Vector snap improvements overlap (they target the same edge). The combined total is less than the sum because many fields are corrected by both.

### Performance

- Geometry preparation: CV ~200ms, Vector ~1s, AcroForm ~50ms
- All geometry runs in parallel with Gemini's ~10s Vision call
- Snapping itself: <10ms per page
- **Net latency added to extraction: zero**

Source: `src/lib/coordinate-snapping/`

Benchmark data: `tests/extraction-benchmark/results/report.md`

## Memory System

### Architecture

The memory system uses an entity-centric model rather than flat key-value storage. This enables cross-document intelligence — information learned from a school enrollment form can auto-fill a medical consent form for the same child.

```
┌──────────────────────────────────┐
│           Entity                  │
│  (person / place / organization)  │
│  canonical_name, relationship,    │
│  confidence, embedding(384)       │
└───────┬───────────────┬──────────┘
        │               │
   ┌────▼────┐    ┌─────▼─────┐
   │  Facts  │    │Relations  │
   │ type:   │    │ subject → │
   │ value:  │    │ predicate │
   │ conf:   │    │ → object  │
   │ source: │    └───────────┘
   └─────────┘
```

### Entity Types

- **Person**: Students, parents, guardians, emergency contacts, physicians
- **Place**: Home address, school address, employer address
- **Organization**: Schools, employers, medical providers

### Confidence Tracking

Each entity and fact carries a confidence score (0.0–1.0) that evolves over time:

| Event | Adjustment |
|-------|-----------|
| Initial extraction | 0.5 base |
| Corroboration (same fact from different document) | +0.15 |
| Frequent access | +0.05 |
| Conflicting fact detected | -0.2 |
| Maximum confidence | 0.95 (never 1.0) |

Thresholds control behavior:
- Display suggestions: confidence ≥ 0.3
- Auto-fill without confirmation: confidence ≥ 0.5
- Memory choice options: confidence ≥ 0.6

### Conflict Resolution

When a new fact contradicts an existing one (e.g., different phone number for the same person), both facts are flagged with `has_conflict = true` and linked via `conflicting_fact_id`. The system surfaces conflicts to the user for manual resolution rather than silently overwriting.

### Sensitive Data Filtering

The extraction pipeline explicitly filters and discards:
- Social Security numbers
- Credit card numbers and CVVs
- Passwords and PINs
- Bank account numbers
- Driver's license and passport numbers
- Tax IDs

Pattern matching catches common formats (XXX-XX-XXXX for SSN, 16-digit card numbers) as a secondary filter beyond the type-based exclusion list.

### Vector Embeddings

Entities and facts are embedded using `text-embedding-004` (384 dimensions) for semantic similarity search. This enables fuzzy matching — a memory entry for "Robert Smith" can match a form field asking for "Bob Smith" or "R. Smith" via embedding similarity (threshold: 0.85).

Source: `src/lib/memory/`

Database schema: `supabase/migrations/20260205000001_create_entity_memory_system.sql`

## PDF Processing

### Input Handling

Fit Form accepts both PDFs and images (JPEG, PNG, WebP, GIF). Image uploads are converted to single-page PDFs using pdf-lib before entering the extraction pipeline, ensuring a unified processing path.

### Azure Document Intelligence (OCR)

Azure's Document Intelligence API extracts full-page text with word-level bounding boxes. This serves three purposes:

1. **Context for question generation**: The full OCR text helps Gemini understand the document's purpose and generate better questions.
2. **OCR snap anchors**: Word positions allow the OCR snap stage to align field boundaries with label text.
3. **Header filter**: Word coverage analysis identifies pre-filled fields.

OCR runs in parallel with field extraction and question generation. Its results are cached in the `documents.ocr_text` column.

### PDF Vector Parsing

For digitally-created PDFs (not scanned), the system extracts drawing commands from the PDF operator list using pdfjs-dist. This yields:

- **Horizontal and vertical lines**: Form field underlines and borders
- **Rectangles**: Checkbox boxes, text area boundaries, table cells

The parser handles PDF coordinate transformations (CTM stack), supports both standard and "new format" path construction, and converts from PDF space (bottom-left origin) to normalized percentage coordinates (top-left origin).

Source: `src/lib/coordinate-snapping/vector-snap.ts`

### Export Pipeline

The export pipeline ensures what-you-see-is-what-you-get (WYSIWYG) fidelity:

1. For each page, create an off-screen Konva stage at the page's pixel dimensions
2. Render each field's value using the same components as the on-screen view:
   - Text fields: Konva.Text with calculated font size
   - Checkboxes: X mark drawn with Konva.Line
   - Signatures: Konva.Image from stored data URI
   - Linked dates: Segmented text in individual date boxes
   - Circle choices: Konva.Circle at the selected option's coordinates
3. Export the Konva stage to a PNG with transparent background
4. Embed the PNG as an overlay on the original PDF page using pdf-lib
5. Return the combined PDF

Font size is calculated per-page: 75% of the smallest text field's height, clamped between 10px and 24px. This ensures consistent sizing across all fields on a page while remaining readable.

Source: `src/lib/konva-export.ts`

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `next` 16 | App Router framework |
| `react` 19 | UI rendering |
| `@google/genai` | Gemini API client |
| `@azure/ai-form-recognizer` | Document Intelligence OCR |
| `@supabase/supabase-js` | Database, auth, storage, realtime |
| `pdf-lib` | PDF parsing and export |
| `react-pdf` | Client-side PDF rendering |
| `konva` / `react-konva` | Canvas-based field rendering |
| `sharp` | Server-side image processing |
| `pdfjs-dist` | PDF operator list parsing (vector extraction) |

## Database

PostgreSQL via Supabase with 14 migrations. Core tables:

- **`documents`**: Upload metadata, processing status, cached AI responses, OCR text
- **`extracted_fields`**: Field coordinates, types, values, detection source
- **`entities`**: People, places, organizations with embeddings
- **`entity_facts`**: Individual facts with confidence and conflict tracking
- **`entity_relationships`**: Subject → predicate → object triples

Vector similarity search uses HNSW indexes on the `vector(384)` columns. Realtime subscriptions on `documents` and `extracted_fields` enable live UI updates during processing.

Schema: `supabase/migrations/`
