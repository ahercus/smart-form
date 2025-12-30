# AutoForm AI: Speed Optimization Implementation Plan

## Overview

Transform processing pipeline from **20-30s wait** → **5-10s with progressive enhancement**

**Key Strategy:**
1. Show fields immediately after Azure (5-10s)
2. Generate questions from Azure data (no vision) in parallel
3. QC runs in background, only updates if needed
4. Stream results via Supabase Realtime

---

## Phase 1: Remove Vision from Question Generation (CRITICAL)

**Impact:** 2-3x faster question generation  
**Time:** 1 hour  
**Risk:** Low

### Tasks

#### 1.1: Add text-only question generation function

**File:** `src/lib/gemini/client.ts`

Add new function:

```typescript
/**
 * Generate questions using Flash model (text-only, no vision)
 * Use for: Question generation from field JSON (don't need image)
 */
export async function generateQuestionsWithFlash(options: {
  prompt: string;
  thinkingLevel?: ThinkingLevel;
}): Promise<string> {
  const { prompt, thinkingLevel = ThinkingLevel.MINIMAL } = options;
  
  return generateFast({ 
    prompt, 
    thinkingLevel,
    jsonOutput: true 
  });
}
```

#### 1.2: Update question generation to use Flash (no vision)

**File:** `src/lib/gemini/vision.ts`

**Current:**
```typescript
export async function generateQuestionsForPage(params: GenerateQuestionsParams) {
  const model = getVisionModel(); // ← Using Pro + Vision
  const imagePart = { inlineData: { data: pageImageBase64, mimeType: "image/png" } };
  const result = await model.generateContent([prompt, imagePart]);
}
```

**New:**
```typescript
export async function generateQuestionsForPage(params: GenerateQuestionsParams) {
  // NO IMAGE - we have field data, don't need vision!
  const { generateQuestionsWithFlash } = await import("./client");
  const prompt = buildQuestionGenerationPrompt(
    pageNumber,
    fields,
    conversationHistory,
    contextNotes,
    memoryContext
  );
  
  const text = await generateQuestionsWithFlash({ 
    prompt,
    thinkingLevel: ThinkingLevel.MINIMAL, // Fast!
  });
  
  return parseGeminiResponse(text);
}
```

**Expected improvement:** 3-5s per page → 1-2s per page

---

## Phase 2: Parallel Page Processing (CRITICAL)

**Impact:** 5x faster for multi-page forms  
**Time:** 30 minutes  
**Risk:** Low

### Tasks

#### 2.1: Make processPages parallel

**File:** `src/lib/orchestrator/page-processor.ts`

**Current:**
```typescript
export async function processPages(...) {
  for (const page of pages) {
    const result = await processPage(...); // ← Sequential, slow!
    results.push(result);
  }
}
```

**New:**
```typescript
export async function processPages(...) {
  // Process all pages in parallel
  const pagePromises = pages.map((page) =>
    processPage({
      documentId,
      userId,
      pageNumber: page.pageNumber,
      pageImageBase64: page.imageBase64,
      fields: page.fields,
      useMemory,
    })
  );

  const results = await Promise.all(pagePromises);
  
  // Results appear as each page completes (via Realtime)
  return results;
}
```

**Note:** Conversation context between pages is preserved because each page includes the full `conversationHistory` in its prompt.

**Expected improvement:** 5-page form: 15-25s → 3-5s

---

## Phase 3: Context Question from Azure Data (HIGH IMPACT)

**Impact:** Instant context question (no vision call)  
**Time:** 1 hour  
**Risk:** Low

### Tasks

#### 3.1: Create form type inference function

**File:** `src/lib/form-analysis.ts` (new file)

```typescript
export interface FormAnalysis {
  type: string; // "health form", "school enrollment", etc.
  keywords: string[]; // Top field keywords
  entities: string[]; // Detected people/entities (patient, student, etc.)
  contextPrompt: string; // Tailored context question
}

/**
 * Analyze form type from Azure Document Intelligence results
 * No vision needed - infer from field labels and structure
 */
export function analyzeFormFromAzure(fields: ExtractedField[]): FormAnalysis {
  const labels = fields.map(f => f.label.toLowerCase()).join(' ');
  
  // Detect form type
  let formType = 'form';
  const keywords: string[] = [];
  const entities: string[] = [];
  
  if (labels.includes('patient') || labels.includes('medical') || labels.includes('allerg') || labels.includes('doctor')) {
    formType = 'health form';
    keywords.push('medical conditions', 'allergies', 'medications');
    entities.push('patient');
  } else if (labels.includes('student') || labels.includes('school') || labels.includes('grade') || labels.includes('enrollment')) {
    formType = 'school enrollment form';
    keywords.push('grade level', 'emergency contacts');
    entities.push('student', 'parent/guardian');
  } else if (labels.includes('employee') || labels.includes('employer') || labels.includes('position') || labels.includes('salary')) {
    formType = 'employment form';
    keywords.push('job title', 'start date');
    entities.push('employee', 'employer');
  } else if (labels.includes('tax') || labels.includes('income') || labels.includes('deduction') || labels.includes('w-')) {
    formType = 'tax form';
    keywords.push('income', 'deductions');
    entities.push('taxpayer');
  } else if (labels.includes('consent') || labels.includes('authorize') || labels.includes('agree')) {
    formType = 'consent form';
    keywords.push('authorization');
  }
  
  // Generate tailored context question using fast text model
  const contextPrompt = generateContextPrompt(formType, keywords, entities);
  
  return { type: formType, keywords, entities, contextPrompt };
}

function generateContextPrompt(formType: string, keywords: string[], entities: string[]): string {
  const entity = entities[0] || 'this';
  
  switch (formType) {
    case 'health form':
      return `Who is this health form for and do they have any medical conditions or allergies we should know about?`;
    case 'school enrollment form':
      return `Which child is being enrolled and what grade are they entering?`;
    case 'employment form':
      return `What position are you applying for and when is your start date?`;
    case 'tax form':
      return `What tax year is this for and are you filing as single, married, or head of household?`;
    case 'consent form':
      return `What are you consenting to and for whom?`;
    default:
      return `Share any context about this form - who it's for, important details, or preferences.`;
  }
}
```

#### 3.2: Update analyze-context route to use Azure data

**File:** `src/app/api/documents/[id]/analyze-context/route.ts`

**Current:** Uses Gemini Vision with image (3-5s)

**New:**
```typescript
export async function GET(...) {
  const document = await getDocument(documentId);
  
  // Check cache
  if (document.tailored_context_question) {
    return NextResponse.json({ question: document.tailored_context_question, cached: true });
  }
  
  // Get fields from database (Azure already extracted them)
  const { data: fields } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("document_id", documentId)
    .is("deleted_at", null);
  
  if (!fields || fields.length === 0) {
    return NextResponse.json({ 
      question: "Share any context about this form - who it's for, important details, or preferences.",
      fallback: true 
    });
  }
  
  // Analyze form from Azure fields (NO VISION CALL!)
  const { analyzeFormFromAzure } = await import("@/lib/form-analysis");
  const analysis = analyzeFormFromAzure(fields);
  
  console.log("[AutoForm] Form analysis:", {
    documentId,
    formType: analysis.type,
    contextQuestion: analysis.contextPrompt,
  });
  
  // Cache and return
  await supabase
    .from("documents")
    .update({ tailored_context_question: analysis.contextPrompt })
    .eq("id", documentId);
  
  return NextResponse.json({
    question: analysis.contextPrompt,
    formType: analysis.type,
    cached: false,
  });
}
```

**Expected improvement:** 3-5s → **instant** (fields already loaded)

---

## Phase 4: Immediate Field Display (CRITICAL UX)

**Impact:** User sees fields in 5-10s instead of 20-30s  
**Time:** 30 minutes  
**Risk:** Low

### Tasks

#### 4.1: Mark document ready after Azure

**File:** `src/app/api/documents/[id]/process/route.ts`

**Current:**
```typescript
// Store extracted fields
await setDocumentFields(id, result.fields);
await updateDocument(id, { page_count: result.pageCount });

// Trigger field refinement (blocks until QC completes)
fetch(`${baseUrl}/api/documents/${id}/refine-fields`, { ... });

return NextResponse.json({
  success: true,
  status: "extracting", // ← Still waiting!
});
```

**New:**
```typescript
// Store extracted fields
await setDocumentFields(id, result.fields);
await updateDocument(id, { page_count: result.pageCount });

// Mark as READY immediately - user can start!
await updateDocumentStatus(id, "ready");

// Trigger refinement + questions in background (true fire-and-forget)
const baseUrl = request.nextUrl.origin;
Promise.all([
  fetch(`${baseUrl}/api/documents/${id}/refine-fields`, {
    method: "POST",
    headers: { Cookie: request.headers.get("cookie") || "" },
  }).catch((err) => {
    console.error("[AutoForm] Background refinement failed:", err);
  }),
  
  fetch(`${baseUrl}/api/documents/${id}/context`, {
    method: "POST", 
    headers: { Cookie: request.headers.get("cookie") || "" },
  }).catch((err) => {
    console.error("[AutoForm] Background question generation failed:", err);
  }),
]);

return NextResponse.json({
  success: true,
  status: "ready", // ← READY NOW!
  field_count: result.fields.length,
  page_count: result.pageCount,
});
```

**Expected improvement:** Time to interaction: 20-30s → 5-10s

---

## Phase 5: Optimistic Question Generation (ARCHITECTURE)

**Impact:** Questions appear before QC completes  
**Time:** 2 hours  
**Risk:** Medium (need reconciliation logic)

### Strategy: Generate questions from Azure fields, reconcile if QC changes things

#### 5.1: Update context route to trigger questions immediately

**File:** `src/app/api/documents/[id]/context/route.ts`

**Current:** Waits for QC to complete before generating questions

**New:**
```typescript
export async function POST(...) {
  const { id: documentId } = await params;
  const { contextNotes } = await request.json();
  
  // Save context notes
  await updateDocument(documentId, { context_notes: contextNotes });
  
  // Start question generation IMMEDIATELY (don't wait for QC)
  const { data: fields } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("document_id", documentId)
    .is("deleted_at", null);
  
  if (!fields || fields.length === 0) {
    return NextResponse.json({ error: "No fields found" }, { status: 404 });
  }
  
  // Generate questions from Azure fields (optimistic)
  const { generateQuestions } = await import("@/lib/orchestrator/question-generator");
  const questionResult = await generateQuestions({
    documentId,
    userId: user.id,
    pageImages, // For composite images if needed
    useMemory: true,
  });
  
  console.log("[AutoForm] Questions generated (optimistic):", {
    documentId,
    questionsGenerated: questionResult.questionsGenerated,
    qcStatus: document.fields_qc_complete ? "complete" : "pending",
  });
  
  return NextResponse.json({
    success: true,
    questionsGenerated: questionResult.questionsGenerated,
  });
}
```

#### 5.2: Add QC reconciliation logic

**File:** `src/lib/orchestrator/field-refinement.ts`

After QC completes, check if any fields were significantly changed:

```typescript
export async function refineFields(...) {
  // ... existing QC logic ...
  
  const result = {
    success: true,
    fieldsAdjusted: adjustedFields,
    fieldsAdded: newFields,
    fieldsRemoved: removedFieldIds,
  };
  
  // Mark QC complete
  await supabase
    .from("documents")
    .update({ fields_qc_complete: true })
    .eq("id", documentId);
  
  // If fields were added, generate questions for them
  if (newFields.length > 0) {
    console.log("[AutoForm] QC added new fields, generating questions:", {
      documentId,
      newFieldCount: newFields.length,
    });
    
    await generateQuestionsForNewFields(documentId, userId, newFields);
  }
  
  // If fields were removed, mark their questions as hidden
  if (removedFieldIds.length > 0) {
    console.log("[AutoForm] QC removed fields, hiding questions:", {
      documentId,
      removedFieldCount: removedFieldIds.length,
    });
    
    await hideQuestionsForFields(documentId, removedFieldIds);
  }
  
  return result;
}

async function generateQuestionsForNewFields(
  documentId: string,
  userId: string,
  newFields: ExtractedField[]
) {
  // Generate questions only for the new fields
  // These will appear as additional questions in the UI
  const { generateQuestionsForPage } = await import("../gemini/vision");
  
  const fieldsByPage = groupFieldsByPage(newFields);
  
  for (const [pageNumber, fields] of fieldsByPage.entries()) {
    const conversationHistory = await getConversationHistory(documentId);
    const result = await generateQuestionsForPage({
      documentId,
      pageNumber,
      pageImageBase64: "", // Not needed since we're not using vision
      fields,
      conversationHistory,
    });
    
    for (const q of result.questions) {
      await saveQuestion(documentId, {
        question: q.question,
        fieldIds: q.fieldIds,
        inputType: q.inputType,
        profileKey: q.profileKey,
        pageNumber,
        choices: q.choices,
      });
    }
  }
}

async function hideQuestionsForFields(documentId: string, fieldIds: string[]) {
  const supabase = createAdminClient();
  
  // Mark questions as hidden if all their fields were removed
  const { data: questions } = await supabase
    .from("document_questions")
    .select("*")
    .eq("document_id", documentId)
    .eq("status", "pending");
  
  for (const q of questions || []) {
    const allFieldsRemoved = q.field_ids.every((id: string) => fieldIds.includes(id));
    if (allFieldsRemoved) {
      await supabase
        .from("document_questions")
        .update({ status: "hidden" })
        .eq("id", q.id);
    }
  }
}
```

**Expected behavior:**
- Questions appear in 1-3s after context submission
- QC runs in background (5-10s)
- If QC adds fields: new questions appear
- If QC removes fields: questions disappear
- User rarely sees updates (Azure is 85-90% accurate)

---

## Phase 6: Streaming Questions via Realtime (UX POLISH)

**Impact:** Progressive question appearance  
**Time:** 1-2 hours  
**Risk:** Low

### Tasks

#### 6.1: Add Realtime subscription to UI

**File:** `src/hooks/useQuestions.ts`

```typescript
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { QuestionGroup } from "@/lib/types";

export function useQuestions(documentId: string) {
  const [questions, setQuestions] = useState<QuestionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // Load initial questions
    const loadQuestions = async () => {
      const { data } = await supabase
        .from("document_questions")
        .select("*")
        .eq("document_id", documentId)
        .neq("status", "hidden")
        .order("page_number")
        .order("created_at");
      
      setQuestions(data || []);
      setLoading(false);
    };
    
    loadQuestions();

    // Subscribe to new questions (they stream in as generated)
    const channel = supabase
      .channel(`questions:${documentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'document_questions',
          filter: `document_id=eq.${documentId}`,
        },
        (payload) => {
          console.log("[AutoForm] New question received via Realtime:", payload.new);
          setQuestions((prev) => [...prev, payload.new as QuestionGroup]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'document_questions',
          filter: `document_id=eq.${documentId}`,
        },
        (payload) => {
          console.log("[AutoForm] Question updated via Realtime:", payload.new);
          setQuestions((prev) =>
            prev.map((q) => (q.id === payload.new.id ? (payload.new as QuestionGroup) : q))
          );
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [documentId, supabase]);

  return { questions, loading };
}
```

#### 6.2: Update AIWizardPanel to show progressive loading

**File:** `src/components/document/AIWizardPanel.tsx`

```typescript
export function AIWizardPanel({ documentId, ... }) {
  const { questions, loading } = useQuestions(documentId);
  
  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
      
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="animate-spin h-4 w-4" />
            <span>Generating more questions...</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Expected UX:**
- First question appears in 1-2s
- More questions stream in over next 2-5s
- User can start answering while more load
- Skeleton loaders show progress

---

## Phase 7: Optional QC Based on Confidence (OPTIMIZATION)

**Impact:** Skip QC for high-confidence forms (80% of cases)  
**Time:** 1 hour  
**Risk:** Low

### Tasks

#### 7.1: Add confidence-based QC decision

**File:** `src/app/api/documents/[id]/process/route.ts`

```typescript
// After Azure extraction
const result = await processDocument(...);

// Calculate average confidence
const avgConfidence = result.fields.reduce((sum, f) => sum + (f.ai_confidence || 0), 0) / result.fields.length;
const needsQC = avgConfidence < 0.85 || result.fields.length > 50;

console.log("[AutoForm] QC decision:", {
  documentId: id,
  avgConfidence: avgConfidence.toFixed(2),
  fieldCount: result.fields.length,
  needsQC,
});

if (needsQC) {
  // Low confidence or complex form - run QC
  fetch(`${baseUrl}/api/documents/${id}/refine-fields`, { ... });
} else {
  // High confidence - skip QC, mark complete
  await updateDocument(id, { fields_qc_complete: true });
  console.log("[AutoForm] Skipping QC - high confidence:", { documentId: id });
}
```

**Expected improvement:** 80% of forms skip 5-10s QC step

---

## Phase 8: Client-Side PDF Rendering (LONG-TERM)

**Impact:** Removes 2-5s server-side rendering  
**Time:** 3-4 hours  
**Risk:** Medium (browser compatibility, large PDFs)

### Approach

Move PDF-to-image conversion to browser using `pdfjs-dist`:

```typescript
// Client uploads PDF to Supabase Storage
// Then renders pages to images in browser
// Uploads images to Storage
// Server processes from images

// Benefits:
// - No server-side PDF rendering overhead
// - Better scalability (client does the work)
// - Can show progress bar to user

// Drawbacks:
// - Requires good client device
// - More complex upload flow
// - Need fallback for weak devices
```

**Decision:** Implement in Phase 2, after core optimizations prove out.

---

## Testing Plan

### Performance Benchmarks

Track these metrics before/after:

| Metric | Baseline | Target | Test Case |
|--------|----------|--------|-----------|
| Time to fields visible | 20-30s | 5-10s | 5-page school form |
| Time to first question | 25-35s | 6-12s | Same form |
| Time to all questions | 30-40s | 8-15s | Same form |
| Question generation per page | 3-5s | 1-2s | Any page with 10+ fields |
| Context question generation | 3-5s | <1s | Any form |

### Test Cases

1. **Simple 2-page form** (W-9, simple contact form)
   - Expected: Fields in 5s, questions in 7s

2. **Complex 5-page form** (school enrollment, health intake)
   - Expected: Fields in 8s, questions in 12s

3. **Forms with low confidence** (scanned, poor quality)
   - Expected: QC runs, adds 5-10s, questions still appear

4. **Form with no Azure fields** (blank/unusual)
   - Expected: Gemini Vision fallback, slower but works

### Edge Cases

- **QC adds many fields**: Questions appear for new fields
- **QC removes fields**: Questions disappear smoothly
- **User answers before questions load**: Questions auto-hide as fields fill
- **Concurrent requests**: Processing lock prevents duplicate runs

---

## Rollout Strategy

### Phase 1 (Week 1): Core Speed Improvements
- Remove vision from question generation
- Parallel page processing
- Context from Azure data
- **Expected result:** 2-3x faster

### Phase 2 (Week 1-2): Progressive Enhancement
- Immediate field display
- Optimistic question generation
- QC reconciliation
- **Expected result:** Perceived instant, actual 5-10s

### Phase 3 (Week 2): Polish
- Streaming questions via Realtime
- Skeleton loaders
- Optional QC based on confidence
- **Expected result:** Feels instant

### Phase 4 (Future): Advanced Optimization
- Client-side PDF rendering
- Caching/prefetching
- Edge function optimization

---

## Success Criteria

✅ User sees fields in <10s (currently 20-30s)  
✅ First question appears in <12s (currently 25-35s)  
✅ 80% of forms skip QC step  
✅ Questions stream progressively (not batch at end)  
✅ No increase in error rate  
✅ Maintained accuracy (85%+ field detection)

---

## Monitoring

Add metrics tracking:

```typescript
// In orchestrator/index.ts
await logMetric({
  event: "processing_complete",
  documentId,
  timings: {
    azure: azureDuration,
    qc: qcDuration || 0,
    questions: questionDuration,
    total: totalDuration,
  },
  stats: {
    pageCount,
    fieldCount,
    questionCount,
    qcSkipped: !qcRan,
  },
});
```

Dashboard to track:
- p50/p90/p99 processing times
- QC skip rate
- Question generation speed
- Error rates by phase
