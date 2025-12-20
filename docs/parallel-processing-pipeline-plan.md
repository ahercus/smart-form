# AutoForm AI: Parallel Processing Pipeline Implementation Plan

## Overview

Transform the document processing flow into a parallel pipeline where:
1. PDF parsing, image rendering, and question generation happen in background
2. User can type directly into PDF fields (primary interaction)
3. AI wizard is opt-in (Drawer on mobile, Sheet on desktop)
4. Two-way sync between field values and questions
5. **Cross-device continuity** - start on desktop, continue on mobile
6. **Collaboration-ready** - state persisted for future sharing features

## Architecture: Stateless Orchestrator + Supabase

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Next.js App (stateless)                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    DocumentOrchestrator                                │  │
│  │  - Reads/writes all state to Supabase                                 │  │
│  │  - Gemini conversations stored in documents.gemini_conversation       │  │
│  │  - Processing progress stored in documents.processing_progress        │  │
│  │  - No in-memory state (survives restarts, works cross-device)         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Supabase                                        │
│  ┌────────────────┐  ┌───────────────────┐  ┌─────────────────────────────┐ │
│  │   documents    │  │ document_questions │  │    Supabase Realtime       │ │
│  │ - status       │  │ - question         │  │  - Push updates to clients │ │
│  │ - gemini_conv  │  │ - field_ids[]      │  │  - No custom SSE needed    │ │
│  │ - progress     │  │ - answer           │  │  - Built-in, free          │ │
│  └────────────────┘  └───────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Benefits of Supabase-First Approach
- **Cross-device**: User starts on desktop, opens phone, sees same progress
- **Resilience**: Server restart doesn't lose in-flight processing
- **Collaboration-ready**: Future feature to share/collaborate on documents
- **Debugging**: Query database to see exactly what happened
- **No custom SSE**: Supabase Realtime handles push updates

## Processing Flow

```
UPLOAD
   │
   ▼
┌─ Page 1: DocAI ──► Render ──► Gemini Vision ──► Questions delivered
│  Page 2: DocAI ──► Render ──► Gemini Vision(+P1 ctx) ──► Questions delivered
│  Page N: DocAI ──► Render ──► Gemini Vision(+P1..N-1 ctx) ──► Questions delivered
│
│  [User answering questions / typing in fields - runs in parallel]
│
└─ ALL QUESTIONS DELIVERED
   │
   ▼
   ┌─ Page 1 QC ─┐
   │  Page 2 QC  │  (parallel, independent)
   │  Page N QC ─┘
   ▼
   READY (fields may have been adjusted)
```

## New Types (add to `src/lib/types.ts`)

```typescript
// Processing phases
type ProcessingPhase =
  | "idle" | "parsing" | "rendering" | "questioning"
  | "qc_pending" | "qc_running" | "ready" | "failed";

// Question that maps to PDF fields
interface QuestionGroup {
  id: string;
  question: string;
  fieldIds: string[];           // Related fields across pages
  inputType: FieldType;
  profileKey?: string;          // For auto-fill from saved profile
  pageNumber: number;
  status: "pending" | "visible" | "answered" | "hidden";
  answer?: string;
}

// Processing progress (stored in Supabase, pushed via Realtime)
interface ProcessingProgress {
  documentId: string;
  phase: ProcessingPhase;
  pagesTotal: number;
  pagesComplete: number;
  questionsDelivered: number;
}

// Gemini conversation message
interface GeminiMessage {
  role: "user" | "model";
  content: string;
  pageNumber?: number;
}
```

## File Structure

### New Files to Create

```
src/lib/orchestrator/
├── index.ts              # DocumentOrchestrator class (~200 lines)
├── page-processor.ts     # Per-page processing pipeline (~150 lines)
└── state.ts              # Supabase state read/write helpers (~80 lines)

src/lib/gemini/
├── client.ts             # Gemini SDK init (~30 lines)
├── vision.ts             # Question generation via vision (~120 lines)
├── qc-adjustment.ts      # Field QC/adjustment (~100 lines)
└── prompts.ts            # Prompt templates (~80 lines)

src/lib/pdf-renderer/
├── index.ts              # PDF page to image (~80 lines)
└── grid-overlay.ts       # Grid + bounding box overlay (~100 lines)

src/app/api/documents/[id]/
└── questions/route.ts    # Questions CRUD (~80 lines)

src/hooks/
├── useDocumentRealtime.ts    # Supabase Realtime subscription (~60 lines)
├── useQuestions.ts           # Question state + realtime sync (~80 lines)
└── useFieldSync.ts           # Two-way field↔question sync (~50 lines)

src/components/document/
├── DocumentPage.tsx          # Main orchestration (~80 lines)
├── PDFWithOverlays.tsx       # PDF + editable field inputs (~120 lines)
├── AIWizardPanel.tsx         # Drawer/Sheet with questions (~100 lines)
├── QuestionCard.tsx          # Single question (~60 lines)
└── ProcessingOverlay.tsx     # Loading skeleton for questions (~40 lines)
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/types.ts` | Add QuestionGroup, ProcessingProgress, GeminiMessage types |
| `src/lib/processing.ts` | Replace with orchestrator integration |
| `src/lib/storage.ts` | Add questions CRUD, conversation storage |
| `src/app/api/documents/[id]/process/route.ts` | Trigger orchestrator, return stream URL |
| `src/components/WizardInterface.tsx` | Major refactor → split into document/ components |
| `src/components/PDFViewer.tsx` | Add editable field inputs (not just display) |

## Implementation Phases

### Phase 1: Foundation
1. Install Gemini SDK: `npm install @google/generative-ai`
2. Add canvas for server-side rendering: `npm install canvas`
3. Create `src/lib/types.ts` additions
4. Create `src/lib/orchestrator/index.ts` skeleton
5. Create `src/lib/gemini/client.ts`

### Phase 2: PDF Rendering Pipeline
6. Create `src/lib/pdf-renderer/index.ts` - PDF to image
7. Create `src/lib/pdf-renderer/grid-overlay.ts` - grid + boxes overlay
8. Test: render single page with grid and field boxes

### Phase 3: Gemini Integration
9. Create `src/lib/gemini/prompts.ts` - question generation prompt
10. Create `src/lib/gemini/vision.ts` - send image, get questions
11. Create `src/lib/gemini/qc-adjustment.ts` - field adjustment prompt
12. Test: generate questions for single page

### Phase 4: Orchestrator
13. Create `src/lib/orchestrator/state.ts` - Supabase state read/write helpers
14. Create `src/lib/orchestrator/page-processor.ts` - per-page pipeline
15. Complete `src/lib/orchestrator/index.ts` - state machine, parallel coordination
16. Test: full pipeline with state persisted to Supabase

### Phase 5: Questions API
17. Create `src/app/api/documents/[id]/questions/route.ts`
18. Add `src/lib/storage.ts` question functions
19. Test: question CRUD operations

### Phase 6: UI - Hooks
20. Create `src/hooks/useDocumentRealtime.ts` - Supabase Realtime subscription
21. Create `src/hooks/useQuestions.ts` - question state + realtime sync
22. Create `src/hooks/useFieldSync.ts` - two-way sync logic

### Phase 7: UI - Components
23. Create `src/components/document/DocumentPage.tsx`
24. Create `src/components/document/PDFWithOverlays.tsx` - editable fields
25. Create `src/components/document/AIWizardPanel.tsx` - Drawer/Sheet
26. Create `src/components/document/QuestionCard.tsx`
27. Create `src/components/document/ProcessingOverlay.tsx`
28. Refactor `src/app/document/[id]/page.tsx` to use new components

### Phase 8: Integration
29. Wire up upload flow to trigger orchestrator
30. Connect Supabase Realtime to UI state
31. Implement two-way field↔question sync
32. Test full end-to-end flow

## Key Implementation Details

### Grid Overlay Spec
- 10x10 grid (10% increments)
- Color: `rgba(100, 100, 100, 0.3)`
- Coordinate labels in margins: 0, 10, 20... 100
- Field boxes: `rgba(59, 130, 246, 0.5)` (blue) with labels

### Core Objective: Minimum User Actions
The goal is **upload → completion → export in as few actions as possible**.

When user answers a question, Gemini should:
1. **Auto-answer related questions** - If user provides DOB, auto-fill any age/birth year fields
2. **Infer from context** - Health question answered? Use that info for similar health fields
3. **Never ask twice** - Same information = same answer, even if phrased differently

This requires re-evaluating pending questions after each answer.

### Question Generation Prompt Structure
```
You are analyzing a PDF form page. The image shows:
- A grid overlay with percentage coordinates (0-100) in the margins
- Blue bounding boxes around detected form fields

For each field, decide if a question is needed:
- SKIP if the field is already filled with a value
- SKIP if you already asked about this in a previous page
- SKIP if you can INFER the answer from information already provided
- ASK only if the field is empty AND you cannot infer the answer

User's provided information so far:
[list of Q&A pairs from conversation history]

Previous questions asked: [list from conversation history]

Return JSON:
{
  "questions": [
    {
      "question": "What is your full legal name?",
      "fieldIds": ["field_uuid_1", "field_uuid_2"],
      "inputType": "text",
      "profileKey": "legal_name"
    }
  ],
  "autoAnswered": [
    {
      "fieldId": "field_uuid_4",
      "value": "42",
      "reasoning": "User provided DOB 1982-03-15, calculated age"
    }
  ],
  "skippedFields": [
    { "fieldId": "field_uuid_3", "reason": "Already filled: John Smith" }
  ]
}
```

### Two-Way Sync Logic
```typescript
// Field change → hide question
function onFieldChange(fieldId: string, value: string) {
  const question = questions.find(q => q.fieldIds.includes(fieldId));
  if (question) {
    if (value.trim()) {
      setQuestionStatus(question.id, "hidden");
    } else {
      setQuestionStatus(question.id, "visible");
    }
  }
}

// Question answer → populate all linked fields
function onQuestionAnswer(questionId: string, answer: string) {
  const question = questions.find(q => q.id === questionId);
  question?.fieldIds.forEach(fieldId => {
    setFieldValue(fieldId, answer);
  });
}
```

### Mobile vs Desktop
```typescript
// In AIWizardPanel.tsx
const isMobile = useMediaQuery("(max-width: 768px)");

return isMobile ? (
  <Drawer open={open} onOpenChange={setOpen}>
    <DrawerContent>{/* questions */}</DrawerContent>
  </Drawer>
) : (
  <Sheet open={open} onOpenChange={setOpen}>
    <SheetContent side="right">{/* questions */}</SheetContent>
  </Sheet>
);
```

## Database Changes

Add to `documents` table:
```sql
ALTER TABLE documents ADD COLUMN
  gemini_conversation JSONB DEFAULT '[]',
  processing_progress JSONB DEFAULT '{}';
```

New `document_questions` table:
```sql
CREATE TABLE document_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  field_ids UUID[] NOT NULL,
  input_type VARCHAR(20) NOT NULL,
  profile_key VARCHAR(100),
  page_number INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  answer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Environment Variables

```env
# Azure Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=...

# Gemini
GEMINI_API_KEY=...
```

## Success Criteria

1. File drop immediately triggers background processing
2. Questions appear incrementally with skeleton loaders
3. User can type directly into PDF fields at any time
4. AI wizard opens in Drawer (mobile) / Sheet (desktop)
5. Typing in field hides corresponding question
6. Clearing field shows question again
7. Answering question populates all linked fields
8. QC adjustments apply without disrupting user input
9. **Cross-device**: Start on desktop, open on mobile, see same state
10. **Resilience**: Close browser mid-processing, reopen, processing continues
