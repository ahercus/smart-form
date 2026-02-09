# Fit Form

Fit Form transforms static PDF forms into intelligent, interactive experiences. Upload any PDF form, and AI automatically detects fields, generates conversational questions, and auto-fills answers from your saved memory -- then exports a completed PDF.

## Features

- **AI Field Detection** -- Gemini 3 Flash Vision extracts form fields with coordinates from any PDF (94% detection accuracy)
- **Coordinate Snapping** -- 5-stage pipeline (AcroForm, OCR, CV, vector, rect) refines field positions to 79% IoU precision
- **Conversational Wizard** -- Step-by-step questions group related fields into a natural flow, with voice input support
- **Entity Memory** -- Saves people, places, and organizations across forms. Auto-fills matching fields instantly without AI calls
- **Overlay Editor** -- Click-to-edit fields directly on the PDF for verification and manual adjustments
- **WYSIWYG Export** -- Konva renders fields identically on-screen and in export, producing pixel-accurate filled PDFs
- **Signature Library** -- Draw, upload, or reuse saved signatures and initials
- **Smart Context** -- AI analyzes the document and asks a tailored context question to improve auto-fill accuracy

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS 4, shadcn/ui |
| Database & Auth | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| PDF | react-pdf (display), pdf-lib (export), Konva (field rendering) |
| AI - Vision & Text | Gemini 3 Flash (`gemini-3-flash-preview`) |
| AI - OCR | Azure Document Intelligence |
| Deployment | Vercel |

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- A [Google AI (Gemini)](https://ai.google.dev) API key
- An [Azure Document Intelligence](https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence) resource

### Setup

1. **Clone and install dependencies**

   ```bash
   git clone <repo-url>
   cd smart-form
   npm install
   ```

2. **Configure environment variables**

   Copy `.env.example` to `.env.local` and fill in your keys:

   ```bash
   cp .env.example .env.local
   ```

   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   GEMINI_API_KEY=your_gemini_api_key
   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=your_azure_endpoint
   AZURE_DOCUMENT_INTELLIGENCE_KEY=your_azure_key
   ```

3. **Apply database migrations**

   Run the SQL migrations in `supabase/migrations/` against your Supabase project, in order. These create the `profiles`, `documents`, `extracted_fields`, `entities`, `entity_facts`, and `entity_relationships` tables along with vector indexes and functions.

4. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Login, signup, password reset
│   ├── (app)/
│   │   ├── dashboard/   # Document list
│   │   ├── document/    # Upload + document editor (wizard & overlay)
│   │   ├── profile/     # User profile
│   │   ├── signatures/  # Signature library
│   │   └── memory/      # Entity memory management
│   └── api/             # 23 API routes
├── components/
│   ├── document/        # PDF viewer, field canvas, questions panel
│   ├── signature/       # Signature pad, picker, manager
│   ├── layout/          # Sidebar, header
│   └── ui/              # shadcn/ui primitives
├── hooks/               # useDocuments, useFieldSync, useQuestions, useVoiceRecording, etc.
└── lib/
    ├── gemini/          # Gemini client, vision extraction, prompts, schemas
    ├── coordinate-snapping/  # 5-stage snapping pipeline
    ├── memory/          # Entity extraction, embeddings, reconciliation
    ├── orchestrator/    # Processing state machine, question generation
    └── types.ts         # Core TypeScript interfaces
```

## How It Works

1. **Upload** -- User uploads a PDF or image. Images are converted to PDF via pdf-lib.
2. **Processing** -- Azure OCR extracts text (for context) while Gemini Vision detects fields page-by-page. A coordinate snapping pipeline refines field positions.
3. **Context** -- AI generates a tailored question about the document. The user's answer improves auto-fill.
4. **Wizard** -- Related fields are grouped into conversational questions. The memory system suggests answers from saved entities.
5. **Overlay** -- Users verify and adjust fields directly on the PDF.
6. **Export** -- Konva renders field values to PNG overlays, which pdf-lib embeds into the original PDF.

## Technical Highlights

- **Multi-agent Gemini orchestration**: 7 distinct Gemini reasoning tasks per document -- field extraction, context analysis, question generation, answer parsing, cross-question auto-fill, memory extraction, and voice transcription. Each has its own prompt, schema, and model configuration.
- **Hybrid coordinate snapping**: Benchmarking 24+ model configurations revealed that Gemini achieves 94% field detection but only 67% coordinate accuracy. A 6-stage deterministic pipeline (AcroForm, OCR, CV, vector, rect snapping) corrects coordinates to 79% IoU with zero regressions.
- **Parallel pipeline**: Geometry extraction (CV lines, PDF vectors, AcroForm fields) runs during Gemini's ~10s Vision call. Snapping adds <10ms. Net latency added: zero.
- **Entity memory**: Cross-document intelligence via entities (people, places, organizations) with confidence tracking, corroboration, conflict detection, and vector similarity search.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical deep-dive.

## Processing States

```
uploading → extracting → ready
                ↘ failed
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
