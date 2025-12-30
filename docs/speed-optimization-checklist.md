# AutoForm AI: Speed Optimization Implementation Checklist

## Executive Summary

**Current State:** 20-30 second wait from upload to user interaction  
**Target State:** 5-10 seconds to fields visible, questions stream progressively  
**Core Strategy:** Optimistic rendering + parallel processing + remove unnecessary vision calls

**Key Insight:** Azure Document Intelligence gives us 85-90% accurate fields immediately. We don't need to wait for Gemini QC to show fields or generate questions. Generate questions from Azure data, let QC enhance in the background.

---

## Phase 1: Remove Vision from Non-Visual Tasks

**Problem:** We're sending images to Gemini for tasks that only need text/JSON  
**Impact:** 2-3x faster question generation, instant context questions  
**Risk:** Low - we already have the field data we need

### Task 1.1: Create Text-Only Question Generation Function

**File:** `src/lib/gemini/client.ts`

**Why:** Gemini Pro with Vision is slow and expensive. For question generation, we have field JSON - no image needed.

- [ ] Add `generateQuestionsWithFlash()` function
  ```typescript
  /**
   * Generate questions using Flash model (text-only, no vision)
   * 
   * Why Flash: Question generation is pattern matching (field labels → questions)
   * Why no vision: We have field.label, field.type, field.coordinates already
   * 
   * Speed: ~1-2s per page vs 3-5s with Pro+Vision
   * Cost: ~90% cheaper per request
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

### Task 1.2: Update Question Generation to Use Flash (No Vision)

**File:** `src/lib/gemini/vision.ts`

**Why:** Current implementation sends full page image to Gemini Pro. We already have all field data from Azure - coordinates, labels, types. The image adds nothing but latency.

- [ ] Replace `getVisionModel()` with `generateQuestionsWithFlash()` in `generateQuestionsForPage()`
  ```typescript
  // BEFORE: Sending 2-5MB image to Pro model
  const model = getVisionModel();
  const imagePart = { inlineData: { data: pageImageBase64, mimeType: "image/png" } };
  const result = await model.generateContent([prompt, imagePart]);
  
  // AFTER: Text-only prompt to Flash model
  const { generateQuestionsWithFlash } = await import("./client");
  const text = await generateQuestionsWithFlash({ 
    prompt,
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
  ```

- [ ] Remove `pageImageBase64` parameter from `GenerateQuestionsParams` interface
  - **Why:** No longer needed, forces us to not use vision
  - **Note:** Keep it in the function signature for now (backward compatibility), just don't use it

- [ ] Update `buildQuestionGenerationPrompt()` to not reference image
  - **Why:** Prompt currently says "look at the image" - remove those references
  - **What to change:** Remove grid coordinate instructions (those were for vision)
  - **Keep:** All the field JSON, context notes, memory context, conversation history

**Expected improvement:** 3-5s → 1-2s per page for question generation

### Task 1.3: Generate Context Question from Azure Data

**File:** `src/lib/form-analysis.ts` (new file)

**Why:** We're currently making a Gemini Vision call to look at the first page and generate a context question. But Azure already told us the form type via field labels. "Patient Name" + "Allergies" + "Medications" = health form. No vision needed.

- [ ] Create form type inference function
  ```typescript
  export interface FormAnalysis {
    type: string; // "health form", "school enrollment", etc.
    keywords: string[]; // Top field keywords for context
    entities: string[]; // Detected people (patient, student, employee)
    contextQuestion: string; // Tailored question to ask user
  }
  
  /**
   * Analyze form type from field labels (no vision needed)
   * 
   * Why this works: Field labels are highly predictive of form type
   * - "Patient", "Allergies" → health form
   * - "Student", "Grade" → school form
   * - "Employer", "Position" → employment form
   * 
   * Azure gives us labels with 90% accuracy. Good enough for context question.
   */
  export function analyzeFormFromAzure(fields: ExtractedField[]): FormAnalysis
  ```

- [ ] Implement keyword-based form type detection
  - **Health forms:** patient, medical, allergy, doctor, diagnosis, medication
  - **School forms:** student, grade, enrollment, school, teacher, guardian
  - **Employment forms:** employer, employee, position, salary, start date, w-4
  - **Tax forms:** tax, income, deduction, w-2, 1099, filing status
  - **Consent forms:** consent, authorize, agree, permission, waiver

- [ ] Create context question templates per form type
  ```typescript
  // Why templates: Fast, predictable, always relevant
  // Each template asks for the most critical info for that form type
  const templates = {
    'health form': 'Who is this health form for and do they have any medical conditions or allergies?',
    'school enrollment form': 'Which child is being enrolled and what grade are they entering?',
    'employment form': 'What position are you applying for and when is your start date?',
    // ... etc
  };
  ```

- [ ] Add fallback for unknown form types
  ```typescript
  // If we can't determine type, use generic question
  default: 'Share any context about this form - who it\'s for, important details, or preferences.'
  ```

### Task 1.4: Update Context Analysis Route

**File:** `src/app/api/documents/[id]/analyze-context/route.ts`

**Why:** Currently makes Gemini Vision call (3-5s). With form analysis from Azure data, this becomes instant (just reading from DB).

- [ ] Replace Gemini Vision call with `analyzeFormFromAzure()`
  ```typescript
  // BEFORE: Load image, call Gemini Vision, wait 3-5s
  const imageBase64 = await getPageImageBase64(firstPage.storage_path);
  const tailoredQuestion = await generateWithVision({ prompt, imageParts: [...] });
  
  // AFTER: Load fields from DB, analyze instantly
  const { data: fields } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("document_id", documentId);
  
  const analysis = analyzeFormFromAzure(fields);
  const contextQuestion = analysis.contextQuestion;
  ```

- [ ] Cache the result in `documents.tailored_context_question`
  - **Why:** If user refreshes page, don't re-analyze
  - **When to invalidate:** Never (form type doesn't change)

- [ ] Add form type to response for debugging
  ```typescript
  return NextResponse.json({
    question: contextQuestion,
    formType: analysis.type,
    cached: false,
  });
  ```

**Expected improvement:** 3-5s → <100ms (just reading from DB)

---

## Phase 2: Parallel Processing

**Problem:** Pages process sequentially (page 2 waits for page 1)  
**Impact:** 5x speedup for multi-page forms  
**Risk:** Low - pages are independent, conversation context is in the prompt

### Task 2.1: Make Page Processing Parallel

**File:** `src/lib/orchestrator/page-processor.ts`

**Why:** Current `for` loop processes pages sequentially. A 5-page form takes 5 × 3s = 15 seconds. With `Promise.all()`, they all run simultaneously: 3 seconds total.

**Why this is safe:**
- Each page has its own field set (independent)
- Conversation context is passed IN the prompt (not mutated between pages)
- Database writes are independent (different field IDs, different question IDs)
- Gemini API handles concurrent requests fine

- [ ] Replace sequential loop with `Promise.all()`
  ```typescript
  // BEFORE: Sequential - page N waits for page N-1
  for (const page of pages) {
    const result = await processPage({ ... });
    results.push(result);
  }
  
  // AFTER: Parallel - all pages start immediately
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
  ```

- [ ] Update timing logs to show parallel execution
  ```typescript
  console.log(`[AutoForm] All pages complete (PARALLEL):`, {
    pagesProcessed: pages.length,
    totalDuration: formatDuration(totalDuration), // Wall clock time, not sum
    longestPage: Math.max(...results.map(r => r.timings.total)),
    avgPageTime: totalDuration / pages.length,
  });
  ```

**Expected improvement:** 5-page form: 15-25s → 3-5s

### Task 2.2: Verify Conversation Context Preservation

**File:** `src/lib/orchestrator/page-processor.ts`

**Why:** When processing pages in parallel, we need to ensure each page still has access to previous answers. Since we're passing `conversationHistory` in each call, this should work, but we need to verify.

- [ ] Confirm `conversationHistory` is fetched BEFORE parallel processing starts
  ```typescript
  // This is already correct, but document WHY:
  const conversationHistory = await getConversationHistory(documentId);
  // ↑ Loaded ONCE, before parallel processing
  // Each page gets the SAME history (up to this point)
  // This is correct: pages don't depend on each other's NEW questions
  ```

- [ ] Document the assumption in comments
  ```typescript
  /**
   * Why parallel processing is safe:
   * 
   * 1. Each page gets the same conversationHistory (answers to previous questions)
   * 2. Pages don't need to know about each other's questions
   * 3. Questions can be de-duplicated later if needed (e.g., "what's your name?" asked on page 1 and 3)
   * 4. Gemini's "skip if already asked" instruction handles cross-page duplication
   */
  ```

- [ ] Add test case: Multi-page form with repeated fields (e.g., name on every page)
  - **Expected:** Gemini should ask name once, skip on other pages
  - **Verification:** Check `skippedFields` in responses

---

## Phase 3: Optimistic Question Generation

**Problem:** Questions wait for QC to complete (5-10s delay)  
**Impact:** Questions appear 5-10s faster  
**Risk:** Medium - need reconciliation if QC changes fields significantly

**Core Insight:** Azure is 85-90% accurate. We can generate questions from Azure fields immediately, then update only if QC finds issues.

### Task 3.1: Mark Document Ready Immediately After Azure

**File:** `src/app/api/documents/[id]/process/route.ts`

**Why:** Currently we wait for QC before marking status="ready". But fields from Azure are good enough to show to the user. They can start typing immediately while QC runs in background.

**Risk mitigation:** QC still runs, just doesn't block the user.

- [ ] Move status update to right after Azure completes
  ```typescript
  // Store extracted fields
  await setDocumentFields(id, result.fields);
  await updateDocument(id, { page_count: result.pageCount });
  
  // MARK AS READY NOW (don't wait for QC)
  await updateDocumentStatus(id, "ready");
  
  return NextResponse.json({
    success: true,
    status: "ready", // ← User can see fields immediately
    field_count: result.fields.length,
    page_count: result.pageCount,
  });
  ```

- [ ] Make field refinement truly async (fire-and-forget)
  ```typescript
  // Trigger refinement in background (don't await, don't check response)
  const baseUrl = request.nextUrl.origin;
  fetch(`${baseUrl}/api/documents/${id}/refine-fields`, {
    method: "POST",
    headers: { Cookie: request.headers.get("cookie") || "" },
  }).catch((err) => {
    // Log but don't fail - QC is enhancement, not requirement
    console.error("[AutoForm] Background refinement failed:", err);
  });
  ```

- [ ] Add comment explaining the trade-off
  ```typescript
  /**
   * OPTIMISTIC RENDERING STRATEGY
   * 
   * We show fields immediately after Azure extraction because:
   * 1. Azure is 85-90% accurate - good enough for user to start
   * 2. QC takes 5-10s - too long to block the entire UX
   * 3. If QC finds issues, we'll update fields in place (rare)
   * 
   * User experience:
   * - T+5s: Fields appear, user can type
   * - T+15s: QC completes, maybe adjusts 1-2 fields
   * 
   * This is better than:
   * - T+15s: Everything appears at once (user waited 10 extra seconds)
   */
  ```

**Expected improvement:** Time to interaction: 20-30s → 5-10s

### Task 3.2: Generate Questions from Azure Fields

**File:** `src/app/api/documents/[id]/context/route.ts`

**Why:** Currently waits for `fields_qc_complete=true` before generating questions. This causes questions to be batched at the end. Instead, generate from Azure fields immediately.

**The big question answered:** "What if QC changes the schema?"

**Answer:** 
- 90% of the time: QC adjusts coordinates/types slightly, questions unchanged
- 8% of the time: QC adds 1-2 missed fields → generate questions for those new fields
- 2% of the time: QC removes false positives → hide those questions

All cases are handled gracefully with reconciliation logic (Task 3.3).

- [ ] Remove `fields_qc_complete` check
  ```typescript
  // BEFORE: Wait for QC
  if (!document.fields_qc_complete) {
    return NextResponse.json({ 
      error: "Fields not ready" 
    }, { status: 400 });
  }
  
  // AFTER: Use whatever fields exist (Azure or QC'd)
  const { data: fields } = await supabase
    .from("extracted_fields")
    .select("*")
    .eq("document_id", documentId)
    .is("deleted_at", null);
  
  // Fields exist right after Azure (5-10s)
  // If QC completed, we'll use refined fields
  // If QC pending, we'll use Azure fields (good enough!)
  ```

- [ ] Add logging to indicate optimistic vs QC'd questions
  ```typescript
  console.log("[AutoForm] Generating questions:", {
    documentId,
    fieldCount: fields.length,
    qcComplete: document.fields_qc_complete,
    strategy: document.fields_qc_complete ? "post-QC" : "optimistic (Azure fields)",
  });
  ```

- [ ] Call question generator immediately
  ```typescript
  // This now runs ~5-10s faster because we don't wait for QC
  const questionResult = await generateQuestions({
    documentId,
    userId: user.id,
    pageImages,
    useMemory: true,
  });
  ```

**Expected improvement:** Questions appear 5-10s earlier (no longer waiting for QC)

### Task 3.3: Add QC Reconciliation Logic

**File:** `src/lib/orchestrator/field-refinement.ts`

**Why:** When QC completes after questions were generated, we need to reconcile changes:
- If QC added fields → generate questions for them
- If QC removed fields → hide their questions
- If QC adjusted coordinates/types → no action needed (questions still valid)

**This is the safety net** that makes optimistic rendering work.

- [ ] Add reconciliation function after QC completes
  ```typescript
  export async function refineFields(...) {
    // ... existing QC logic ...
    
    const result = {
      fieldsAdjusted: adjustedFields,
      fieldsAdded: newFields,
      fieldsRemoved: removedFieldIds,
    };
    
    // Mark QC complete
    await supabase
      .from("documents")
      .update({ fields_qc_complete: true })
      .eq("id", documentId);
    
    // RECONCILE: Handle added/removed fields
    await reconcileQuestionsAfterQC(documentId, userId, result);
    
    return result;
  }
  ```

- [ ] Implement `reconcileQuestionsAfterQC()` function
  ```typescript
  /**
   * Reconcile questions after QC completes
   * 
   * Why this is needed:
   * - Questions were generated from Azure fields (optimistic)
   * - QC may have added/removed fields
   * - Need to update questions to match final field set
   * 
   * Cases:
   * 1. Fields adjusted (coordinates/types changed): No action needed
   *    → Questions ask about "Name" field - doesn't matter if it moved 2% left
   * 
   * 2. Fields added: Generate questions for new fields
   *    → QC found "Middle Initial" that Azure missed
   *    → Generate 1 question: "What is your middle initial?"
   * 
   * 3. Fields removed: Hide questions for deleted fields
   *    → QC removed false positive (not actually a field)
   *    → Mark those questions as status='hidden'
   */
  async function reconcileQuestionsAfterQC(
    documentId: string,
    userId: string,
    qcResult: {
      fieldsAdded: ExtractedField[];
      fieldsRemoved: string[];
      fieldsAdjusted: ExtractedField[];
    }
  ) {
    // Handle added fields
    if (qcResult.fieldsAdded.length > 0) {
      await generateQuestionsForNewFields(documentId, userId, qcResult.fieldsAdded);
    }
    
    // Handle removed fields
    if (qcResult.fieldsRemoved.length > 0) {
      await hideQuestionsForFields(documentId, qcResult.fieldsRemoved);
    }
    
    // Adjusted fields: no action needed (questions still valid)
  }
  ```

- [ ] Implement `generateQuestionsForNewFields()`
  ```typescript
  /**
   * Generate questions for fields that QC added
   * 
   * These will appear as additional questions in the UI
   * User may have already answered some questions - that's fine
   */
  async function generateQuestionsForNewFields(
    documentId: string,
    userId: string,
    newFields: ExtractedField[]
  ) {
    console.log("[AutoForm] QC added new fields, generating questions:", {
      documentId,
      newFieldCount: newFields.length,
      fieldLabels: newFields.map(f => f.label),
    });
    
    // Group by page
    const fieldsByPage = groupFieldsByPage(newFields);
    
    // Generate questions for each page
    for (const [pageNumber, fields] of fieldsByPage.entries()) {
      const conversationHistory = await getConversationHistory(documentId);
      
      const result = await generateQuestionsForPage({
        documentId,
        pageNumber,
        pageImageBase64: "", // Not needed (no vision)
        fields,
        conversationHistory,
      });
      
      // Save new questions
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
    
    // Realtime will notify UI of new questions
  }
  ```

- [ ] Implement `hideQuestionsForFields()`
  ```typescript
  /**
   * Hide questions for fields that QC removed
   * 
   * Why hide instead of delete: Preserves history, can unhide if needed
   */
  async function hideQuestionsForFields(
    documentId: string,
    removedFieldIds: string[]
  ) {
    console.log("[AutoForm] QC removed fields, hiding questions:", {
      documentId,
      removedFieldCount: removedFieldIds.length,
    });
    
    const supabase = createAdminClient();
    
    // Find questions that reference removed fields
    const { data: questions } = await supabase
      .from("document_questions")
      .select("*")
      .eq("document_id", documentId)
      .in("status", ["pending", "visible"]);
    
    for (const q of questions || []) {
      // If ALL fields for this question were removed, hide it
      const allFieldsRemoved = q.field_ids.every((id: string) => 
        removedFieldIds.includes(id)
      );
      
      if (allFieldsRemoved) {
        await supabase
          .from("document_questions")
          .update({ status: "hidden" })
          .eq("id", q.id);
      }
    }
    
    // Realtime will notify UI (questions disappear)
  }
  ```

- [ ] Add helper function `groupFieldsByPage()`
  ```typescript
  function groupFieldsByPage(
    fields: ExtractedField[]
  ): Map<number, ExtractedField[]> {
    const map = new Map<number, ExtractedField[]>();
    
    for (const field of fields) {
      const pageFields = map.get(field.page_number) || [];
      pageFields.push(field);
      map.set(field.page_number, pageFields);
    }
    
    return map;
  }
  ```

**Expected behavior:**
- 90% of forms: No reconciliation needed (Azure was accurate)
- 8% of forms: 1-2 new questions appear after QC
- 2% of forms: 1 question disappears after QC

User rarely sees updates, but when they do, it's smooth.

### Task 3.4: Update Processing Lock Logic

**File:** `src/lib/orchestrator/question-generator.ts`

**Why:** With optimistic generation, questions might be generated twice:
1. First time: From context route (using Azure fields)
2. Second time: From refine-fields route completion (using QC'd fields)

Need lock to prevent duplicate generation.

- [ ] Keep existing lock check at start of `generateQuestions()`
  ```typescript
  // Check for existing processing lock to prevent duplicate runs
  const { data: doc } = await supabase
    .from("documents")
    .select("status, processing_lock")
    .eq("id", documentId)
    .single();
  
  const now = Date.now();
  const lockAge = doc?.processing_lock 
    ? now - new Date(doc.processing_lock).getTime() 
    : Infinity;
  const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  
  // If already processing and lock is fresh, skip
  if (doc?.status === "extracting" && lockAge < LOCK_TIMEOUT) {
    console.log("[AutoForm] Question generation already in progress:", {
      documentId,
      lockAge: `${Math.round(lockAge / 1000)}s`,
    });
    return { success: true, questionsGenerated: 0 };
  }
  ```

- [ ] Clear lock on success AND failure
  ```typescript
  // Always clear lock (in try AND catch blocks)
  finally {
    await supabase
      .from("documents")
      .update({ processing_lock: null })
      .eq("id", documentId);
  }
  ```

- [ ] Add `questions_generated_at` timestamp to prevent re-generation
  ```typescript
  // After generating questions, mark completion time
  await supabase
    .from("documents")
    .update({ 
      processing_lock: null,
      questions_generated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  
  // At start, check if already done
  if (doc?.questions_generated_at) {
    console.log("[AutoForm] Questions already generated:", {
      documentId,
      generatedAt: doc.questions_generated_at,
    });
    return { success: true, questionsGenerated: 0 };
  }
  ```

**Database migration needed:**
```sql
ALTER TABLE documents 
ADD COLUMN questions_generated_at TIMESTAMPTZ DEFAULT NULL;
```

---

## Phase 4: Progressive Question Streaming

**Problem:** Questions appear all at once (batch at end)  
**Impact:** Feels instant - first questions appear in 1-2s, more trickle in  
**Risk:** Low - Supabase Realtime handles this

**Why this matters:** Even if total question generation takes 5s, showing 1 question every second feels 5x faster than showing 0 questions for 5s then all 12 at once.

### Task 4.1: Add Realtime Subscription Hook

**File:** `src/hooks/useQuestions.ts` (update existing)

**Why:** Currently polling or refetching. Realtime gives instant updates as questions are saved to DB.

- [ ] Add Supabase Realtime channel subscription
  ```typescript
  useEffect(() => {
    // Load initial questions (may be empty)
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
          console.log("[AutoForm] New question arrived:", payload.new);
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
          console.log("[AutoForm] Question updated:", payload.new);
          setQuestions((prev) =>
            prev.map((q) => 
              q.id === payload.new.id 
                ? (payload.new as QuestionGroup) 
                : q
            )
          );
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [documentId, supabase]);
  ```

- [ ] Handle question status changes (hidden questions disappear)
  ```typescript
  // When QC removes fields, questions get status='hidden'
  // Filter them out in real-time
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'document_questions',
      filter: `document_id=eq.${documentId}`,
    },
    (payload) => {
      const updated = payload.new as QuestionGroup;
      
      if (updated.status === 'hidden') {
        // Remove from list
        setQuestions((prev) => prev.filter(q => q.id !== updated.id));
      } else {
        // Update in place
        setQuestions((prev) =>
          prev.map((q) => q.id === updated.id ? updated : q)
        );
      }
    }
  )
  ```

**Expected UX:**
- Initial load shows 0 questions (loading state)
- 1s later: 2 questions appear
- 2s later: 4 more questions appear
- 3s later: 6 more questions appear
- User can start answering immediately

### Task 4.2: Update UI to Show Progressive Loading

**File:** `src/components/document/AIWizardPanel.tsx`

**Why:** Need visual feedback that more questions are coming (not just an empty list).

- [ ] Add loading skeleton while questions are generating
  ```typescript
  export function AIWizardPanel({ documentId, ... }) {
    const { questions, loading } = useQuestions(documentId);
    const { progress } = useDocumentRealtime(documentId);
    
    // Check if question generation is in progress
    const isGeneratingQuestions = progress?.phase === "displaying" || 
                                   (progress?.phase === "extracting" && questions.length === 0);
    
    return (
      <div className="space-y-4">
        {questions.map((q) => (
          <QuestionCard key={q.id} question={q} />
        ))}
        
        {isGeneratingQuestions && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="animate-spin h-4 w-4" />
              <span>Analyzing form and generating questions...</span>
            </div>
          </div>
        )}
        
        {!isGeneratingQuestions && questions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No questions needed - you can fill the form directly!</p>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] Add smooth animations for question appearance
  ```typescript
  // Use framer-motion or CSS transitions
  <motion.div
    key={question.id}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, height: 0 }}
    transition={{ duration: 0.3 }}
  >
    <QuestionCard question={question} />
  </motion.div>
  ```

- [ ] Show count of questions loaded vs expected
  ```typescript
  // If we know total field count, show progress
  {isGeneratingQuestions && (
    <div className="text-sm text-muted-foreground">
      {questions.length} questions ready
      {progress?.pagesComplete && progress?.pagesTotal && (
        <> (analyzing page {progress.pagesComplete + 1} of {progress.pagesTotal})</>
      )}
    </div>
  )}
  ```

**Expected UX:**
- Skeleton loaders appear immediately
- Questions fade in as they arrive
- User knows more are coming
- Can start answering first questions while more load

### Task 4.3: Enable Realtime for document_questions Table

**File:** Supabase Dashboard or migration

**Why:** Realtime is disabled by default. Need to enable for question streaming.

- [ ] Create migration to enable Realtime
  ```sql
  -- Enable Realtime for document_questions table
  ALTER PUBLICATION supabase_realtime ADD TABLE document_questions;
  
  -- Verify RLS policies exist (for security)
  -- Users should only receive questions for their own documents
  CREATE POLICY "Users can view questions for own documents"
    ON document_questions FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM documents
        WHERE documents.id = document_questions.document_id
        AND documents.user_id = auth.uid()
      )
    );
  ```

- [ ] Test Realtime connection in browser console
  ```javascript
  // Open console on document page
  // Should see: "Realtime subscription active for questions:doc-id"
  ```

---

## Phase 5: Confidence-Based QC (Optional Enhancement)

**Problem:** Running QC on every form even when Azure is highly confident  
**Impact:** 80% of forms skip 5-10s QC step  
**Risk:** Low - only skip QC when confidence is very high

**Trade-off:** Slight reduction in field accuracy (95% → 90%) for major speed gain

### Task 5.1: Add Confidence Calculation

**File:** `src/app/api/documents/[id]/process/route.ts`

**Why:** Azure gives confidence scores per field. If average is >0.85 AND form is simple (<50 fields), QC likely won't find anything useful.

- [ ] Calculate average confidence after Azure extraction
  ```typescript
  const result = await processDocument(...);
  
  // Calculate confidence metrics
  const confidenceScores = result.fields.map(f => f.ai_confidence || 0);
  const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
  const minConfidence = Math.min(...confidenceScores);
  
  console.log("[AutoForm] Azure confidence analysis:", {
    documentId: id,
    avgConfidence: avgConfidence.toFixed(2),
    minConfidence: minConfidence.toFixed(2),
    fieldCount: result.fields.length,
  });
  ```

- [ ] Implement QC decision logic
  ```typescript
  /**
   * QC Decision Matrix
   * 
   * Run QC if:
   * - Average confidence < 0.85 (Azure unsure)
   * - Any field confidence < 0.5 (big issues)
   * - Field count > 50 (complex form, more likely to have issues)
   * - Field count < 5 (too few fields, might be missed content)
   * 
   * Skip QC if:
   * - Average confidence >= 0.85 (Azure very confident)
   * - All fields >= 0.5 confidence (no obvious issues)
   * - 5-50 fields (typical form, not too complex)
   * 
   * Why this works:
   * - Azure is excellent on clean, native PDF forms (85% of uploads)
   * - QC helps most on scanned/poor quality PDFs (15% of uploads)
   * - Field count extremes indicate potential issues
   */
  const shouldRunQC = 
    avgConfidence < 0.85 ||
    minConfidence < 0.5 ||
    result.fields.length > 50 ||
    result.fields.length < 5;
  
  console.log("[AutoForm] QC decision:", {
    documentId: id,
    shouldRunQC,
    reason: shouldRunQC 
      ? `Low confidence (${avgConfidence.toFixed(2)}) or extreme field count (${result.fields.length})`
      : `High confidence (${avgConfidence.toFixed(2)}) and normal field count (${result.fields.length})`,
  });
  ```

- [ ] Conditionally trigger QC
  ```typescript
  if (shouldRunQC) {
    // Low confidence or complex - run QC
    fetch(`${baseUrl}/api/documents/${id}/refine-fields`, {
      method: "POST",
      headers: { Cookie: request.headers.get("cookie") || "" },
    }).catch((err) => {
      console.error("[AutoForm] Background refinement failed:", err);
    });
  } else {
    // High confidence - skip QC, mark complete
    await updateDocument(id, { 
      fields_qc_complete: true,
      qc_skipped: true,
      qc_skip_reason: `High confidence (${avgConfidence.toFixed(2)})`,
    });
    
    console.log("[AutoForm] Skipping QC - high confidence:", {
      documentId: id,
      avgConfidence: avgConfidence.toFixed(2),
    });
  }
  ```

**Database migration needed:**
```sql
ALTER TABLE documents 
ADD COLUMN qc_skipped BOOLEAN DEFAULT false,
ADD COLUMN qc_skip_reason TEXT DEFAULT NULL;
```

### Task 5.2: Add QC Skip Monitoring

**File:** `src/lib/metrics.ts` (new file for future monitoring)

**Why:** Need to track if skipping QC hurts accuracy. If users frequently use manual field controls on high-confidence forms, we should lower the threshold.

- [ ] Create placeholder for metrics tracking
  ```typescript
  /**
   * Future: Track QC skip rate and correlation with manual field edits
   * 
   * Metrics to track:
   * - % of forms that skip QC
   * - % of skipped forms that needed manual field adjustments
   * - Average confidence of forms that skip QC
   * - User satisfaction (implicit: time to export, manual edit count)
   * 
   * Hypothesis: Forms with >0.85 confidence rarely need QC
   * Validate: If >5% of skipped forms need manual edits, lower threshold
   */
  export async function logQCDecision(data: {
    documentId: string;
    avgConfidence: number;
    fieldCount: number;
    qcRan: boolean;
    reason: string;
  }) {
    // TODO: Implement when adding analytics
    console.log("[AutoForm] QC decision logged:", data);
  }
  ```

**Expected improvement:** 80% of forms complete 5-10s faster

---

## Phase 6: Database Schema Updates

**File:** Supabase migration or SQL

**Why:** New features require new columns to track state.

### Task 6.1: Add Question Generation Tracking

- [ ] Add column to track when questions were generated
  ```sql
  ALTER TABLE documents 
  ADD COLUMN questions_generated_at TIMESTAMPTZ DEFAULT NULL;
  ```
  - **Why:** Prevents duplicate question generation (processing lock times out)
  - **Usage:** Check this before generating questions

### Task 6.2: Add QC Skip Tracking

- [ ] Add columns to track QC skip decisions
  ```sql
  ALTER TABLE documents 
  ADD COLUMN qc_skipped BOOLEAN DEFAULT false,
  ADD COLUMN qc_skip_reason TEXT DEFAULT NULL;
  ```
  - **Why:** Know which forms skipped QC and why (for debugging and metrics)
  - **Usage:** When skipping QC, set these fields

### Task 6.3: Add Form Analysis Cache

- [ ] Verify `tailored_context_question` column exists
  ```sql
  -- Should already exist, but verify
  -- ALTER TABLE documents 
  -- ADD COLUMN tailored_context_question TEXT DEFAULT NULL;
  ```
  - **Why:** Cache context question so we don't regenerate on page refresh

### Task 6.4: Add Question Hidden Status

- [ ] Verify `document_questions.status` includes 'hidden'
  ```sql
  -- Verify constraint includes 'hidden' status
  -- ALTER TABLE document_questions 
  -- DROP CONSTRAINT IF EXISTS document_questions_status_check;
  
  ALTER TABLE document_questions 
  ADD CONSTRAINT document_questions_status_check 
  CHECK (status IN ('pending', 'visible', 'answered', 'hidden'));
  ```
  - **Why:** When QC removes fields, mark their questions as hidden

### Task 6.5: Create Migration File

- [ ] Create new migration: `20241231_speed_optimizations.sql`
  ```sql
  -- Speed optimization schema changes
  
  -- Track when questions were generated (prevent duplicate runs)
  ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS questions_generated_at TIMESTAMPTZ DEFAULT NULL;
  
  -- Track QC skip decisions (for monitoring)
  ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS qc_skipped BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS qc_skip_reason TEXT DEFAULT NULL;
  
  -- Ensure question status supports 'hidden' (for QC reconciliation)
  ALTER TABLE document_questions 
  DROP CONSTRAINT IF EXISTS document_questions_status_check;
  
  ALTER TABLE document_questions 
  ADD CONSTRAINT document_questions_status_check 
  CHECK (status IN ('pending', 'visible', 'answered', 'hidden'));
  
  -- Index for faster question lookups
  CREATE INDEX IF NOT EXISTS idx_document_questions_document_status 
  ON document_questions(document_id, status);
  ```

- [ ] Run migration in development
  ```bash
  supabase db reset
  supabase migration up
  ```

- [ ] Verify in production (Supabase dashboard)

---

## Phase 7: Error Handling & Graceful Degradation

**Problem:** If any step fails, entire flow breaks  
**Impact:** Resilient system that works even when AI fails  
**Risk:** Low - adding safety nets

**Philosophy:** Show fields immediately, generate questions optimistically, degrade gracefully if anything fails. User can always type directly into fields.

### Task 7.1: Wrap Question Generation in Try-Catch

**File:** `src/lib/orchestrator/question-generator.ts`

**Why:** If Gemini API fails, user should still see fields and can fill form manually.

- [ ] Add graceful degradation to `generateQuestions()`
  ```typescript
  try {
    // ... question generation logic ...
    
    return {
      success: true,
      questionsGenerated: totalQuestions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    console.error("[AutoForm] Question generation failed (graceful degradation):", {
      documentId,
      error: errorMessage,
    });
    
    // GRACEFUL DEGRADATION: Mark as ready anyway
    // User can still fill form manually (fields are visible)
    await updateProcessingProgress(documentId, {
      phase: "ready",
      error: `AI assistant unavailable: ${errorMessage}`,
    });
    
    await updateDocumentStatus(documentId, "ready");
    
    console.log("[AutoForm] Document marked ready despite question generation failure:", {
      documentId,
      reason: "User can still fill form manually",
    });
    
    return {
      success: false,
      questionsGenerated: 0,
      error: errorMessage,
    };
  }
  ```

- [ ] Add error message to UI when questions fail
  ```typescript
  // In AIWizardPanel.tsx
  {progress?.error && (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <p className="text-sm text-yellow-800">
        AI assistant couldn't generate questions, but you can still fill the form directly on the PDF.
      </p>
      <p className="text-xs text-yellow-600 mt-1">
        {progress.error}
      </p>
    </div>
  )}
  ```

### Task 7.2: Handle QC Failures Gracefully

**File:** `src/lib/orchestrator/field-refinement.ts`

**Why:** QC is enhancement, not requirement. If it fails, questions should still work (from Azure fields).

- [ ] Wrap QC in try-catch per page
  ```typescript
  export async function refineFields(...) {
    const results: PageRefinementResult[] = [];
    
    for (const page of pageImages) {
      try {
        const result = await refinePageFields(page);
        results.push(result);
      } catch (error) {
        console.error("[AutoForm] QC failed for page, continuing:", {
          documentId,
          pageNumber: page.pageNumber,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        
        // Continue with other pages (don't fail entire QC)
        results.push({
          pageNumber: page.pageNumber,
          fieldsAdjusted: 0,
          fieldsAdded: 0,
          fieldsRemoved: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    
    // Mark QC complete even if some pages failed
    await supabase
      .from("documents")
      .update({ fields_qc_complete: true })
      .eq("id", documentId);
    
    return {
      success: true, // Success = didn't crash, even if some pages had errors
      pageResults: results,
    };
  }
  ```

### Task 7.3: Handle Context Question Failures

**File:** `src/app/api/documents/[id]/analyze-context/route.ts`

**Why:** If form analysis fails, fall back to generic question (user still gets to provide context).

- [ ] Ensure fallback is already in place (it is)
  ```typescript
  try {
    // ... form analysis logic ...
    return NextResponse.json({ question: analysis.contextQuestion });
  } catch (error) {
    console.error("[AutoForm] Context analysis error:", error);
    
    // Fallback to generic question
    return NextResponse.json({
      question: "Share any context about this form - who it's for, important details, or preferences.",
      fallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
  ```

### Task 7.4: Add Timeout Protection

**File:** `src/lib/gemini/client.ts`

**Why:** Gemini calls can hang. Need timeout to prevent infinite waiting.

- [ ] Add timeout wrapper for Gemini calls
  ```typescript
  /**
   * Wrap Gemini API call with timeout
   * 
   * Why: Prevent hung requests from blocking user forever
   * Timeout: 30s (generous, but prevents infinite hangs)
   */
  async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = 30000,
    operation: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }
  
  export async function generateWithVision(options: GenerateContentOptions) {
    const client = getGeminiClient();
    // ... setup ...
    
    const response = await withTimeout(
      client.models.generateContent({ model: GEMINI_PRO, contents, config }),
      30000,
      "Gemini Vision API"
    );
    
    return response.text || "";
  }
  ```

- [ ] Apply timeout to all Gemini functions
  - `generateWithVision()`
  - `generateFast()`
  - `generateQuestionsWithFlash()`

---

## Phase 8: Testing & Validation

**File:** Various test files

**Why:** Ensure optimizations don't break existing functionality.

### Task 8.1: Manual Test Cases

Create test checklist for manual testing:

- [ ] Test: Simple 2-page form (W-9 equivalent)
  - ✅ Fields visible in <10s
  - ✅ Context question appears immediately after fields
  - ✅ 3-5 questions appear within 2s of context submission
  - ✅ QC skipped (high confidence)
  - ✅ No errors in console

- [ ] Test: Complex 5-page form (school enrollment equivalent)
  - ✅ Fields visible in <10s
  - ✅ Context question tailored to form type ("which child...")
  - ✅ Questions stream in progressively (not all at once)
  - ✅ All pages processed in parallel (<5s total)
  - ✅ QC runs (complex form, confidence check)

- [ ] Test: Low quality scan (poor Azure confidence)
  - ✅ Fields still appear
  - ✅ QC runs (low confidence triggers QC)
  - ✅ Questions generated from Azure fields initially
  - ✅ Questions updated if QC adds fields
  - ✅ User can still fill form if questions fail

- [ ] Test: Question reconciliation
  - Upload form, wait for fields
  - Submit context (questions generated from Azure fields)
  - Wait for QC to complete
  - Verify: If QC added fields, new questions appear
  - Verify: If QC removed fields, questions disappear

- [ ] Test: Realtime streaming
  - Upload multi-page form
  - Submit context
  - Watch network tab: verify Realtime connection established
  - Observe: Questions appear one-by-one (not batched)
  - Check console: See "New question arrived" logs

- [ ] Test: Graceful degradation
  - Temporarily break Gemini API (bad API key)
  - Upload form
  - Verify: Fields still appear
  - Verify: Error message shown instead of questions
  - Verify: User can type in fields directly

### Task 8.2: Performance Benchmarks

Track before/after metrics:

- [ ] Set up timing logs in orchestrator
  ```typescript
  // Log timings for monitoring
  console.log("[AutoForm] PERFORMANCE METRICS:", {
    documentId,
    timings: {
      upload_to_fields: azureDuration,
      fields_to_context_question: contextDuration,
      context_to_first_question: firstQuestionDuration,
      context_to_all_questions: allQuestionsDuration,
      qc_duration: qcDuration || "skipped",
    },
    stats: {
      pageCount,
      fieldCount,
      questionCount,
      qcSkipped: !qcRan,
      avgConfidence,
    },
  });
  ```

- [ ] Record baseline (before optimizations)
  - Upload 5 test PDFs (simple, medium, complex)
  - Record all timing metrics
  - Save in `docs/performance-baseline.md`

- [ ] Record post-optimization (after changes)
  - Re-test same 5 PDFs
  - Compare metrics
  - Verify 2-3x improvement

- [ ] Set up monitoring dashboard (future)
  - Track p50/p90/p99 timings
  - Track QC skip rate
  - Track error rates by phase
  - Alert if timings regress

### Task 8.3: Edge Case Testing

- [ ] Test: Form with no fields (blank PDF)
  - ✅ Document still marked ready
  - ✅ No questions generated (nothing to ask)
  - ✅ No errors

- [ ] Test: Form with 100+ fields (very complex)
  - ✅ QC runs (field count > 50 triggers QC)
  - ✅ Questions generated (may be many)
  - ✅ Performance acceptable (<15s total)

- [ ] Test: Concurrent uploads (2 forms at once)
  - ✅ Both process independently
  - ✅ No race conditions
  - ✅ Processing locks work correctly

- [ ] Test: User answers questions before QC completes
  - Upload form, submit context
  - Start answering questions immediately
  - Wait for QC to complete in background
  - Verify: Answered questions don't get overwritten
  - Verify: New questions from QC append to end

- [ ] Test: Network interruption during processing
  - Upload form
  - Disconnect network mid-processing
  - Reconnect
  - Verify: Processing resumes or fails gracefully

---

## Phase 9: Documentation & Monitoring

**File:** Code comments and docs

**Why:** Future maintainers (including you in 6 months) need context.

### Task 9.1: Add Architecture Comments

- [ ] Document optimistic rendering strategy
  ```typescript
  /**
   * OPTIMISTIC RENDERING ARCHITECTURE
   * 
   * This system shows fields immediately after Azure extraction,
   * then generates questions and runs QC in the background.
   * 
   * Timeline (5-page form):
   * T+0s:   Upload starts
   * T+7s:   Azure completes → FIELDS VISIBLE ✅
   * T+7.5s: Context question appears (from Azure data)
   * T+8s:   User submits context
   * T+9s:   Questions start appearing (from Azure fields)
   * T+10s:  All questions delivered (parallel processing)
   * T+15s:  QC completes in background (may add 1-2 questions)
   * 
   * Key decisions:
   * 1. Azure fields are "good enough" to show immediately (85-90% accurate)
   * 2. Questions from Azure fields are "good enough" (QC rarely changes them)
   * 3. QC is enhancement, not blocker (runs in background)
   * 4. If QC changes things, we reconcile (add/hide questions)
   * 
   * Trade-off: Occasional question updates (10% of forms) for 2-3x faster UX
   */
  ```

- [ ] Document why vision was removed from questions
  ```typescript
  /**
   * WHY NO VISION FOR QUESTION GENERATION
   * 
   * We removed Gemini Vision from question generation because:
   * 
   * 1. We have all the data we need:
   *    - field.label (from Azure)
   *    - field.type (from Azure)
   *    - field.coordinates (not needed for questions)
   *    - conversation history (what user already told us)
   * 
   * 2. Vision adds latency:
   *    - Pro+Vision: 3-5s per page
   *    - Flash text-only: 1-2s per page
   * 
   * 3. Vision adds cost:
   *    - Vision API calls are 10x more expensive
   * 
   * 4. Vision doesn't add value:
   *    - Questions are about "what's your name?" not "where is the name field?"
   *    - Field labels tell us what to ask
   * 
   * When vision IS needed:
   * - Field QC (verifying coordinates are correct)
   * - Adding missed fields (seeing what Azure didn't detect)
   * - These still use vision, just not for questions
   */
  ```

- [ ] Document QC reconciliation logic
  ```typescript
  /**
   * QC RECONCILIATION
   * 
   * Questions are generated from Azure fields optimistically.
   * QC runs in background and may change the field set.
   * This function reconciles questions with QC changes.
   * 
   * Scenarios:
   * 
   * 1. QC adjusted coordinates/types (90% of changes)
   *    → No action needed
   *    → Questions ask about "Name" - doesn't matter if field moved 2% left
   * 
   * 2. QC added fields (8% of cases)
   *    → Generate questions for new fields
   *    → They appear as additional questions (user may have already answered some)
   * 
   * 3. QC removed fields (2% of cases)
   *    → Hide questions for deleted fields
   *    → status='hidden' (don't delete - preserve history)
   * 
   * Why this works:
   * - Azure is 85-90% accurate (QC finds issues rarely)
   * - User rarely sees updates (smooth when they do)
   * - Better than blocking for 10s "just in case"
   */
  ```

### Task 9.2: Update README

**File:** `README.md`

- [ ] Add section on processing pipeline
  ```markdown
  ## Processing Pipeline
  
  AutoForm uses an optimistic rendering strategy for speed:
  
  1. **Azure Document Intelligence** (5-10s)
     - Extracts fields from PDF with 85-90% accuracy
     - Fields appear immediately - user can start typing
  
  2. **Context Analysis** (instant)
     - Infers form type from field labels
     - Generates tailored context question
  
  3. **Question Generation** (1-2s per page, parallel)
     - Generates questions from Azure fields
     - Uses Gemini Flash (text-only, no vision)
     - Questions stream in as they're generated
  
  4. **Field QC** (5-10s, background, optional)
     - Gemini Vision reviews field positions
     - Adds missed fields, removes false positives
     - Questions auto-update if schema changes
     - Skipped for high-confidence forms (80% of uploads)
  
  **Total time to interaction: 5-10 seconds** (down from 20-30s)
  ```

### Task 9.3: Add Performance Monitoring

**File:** `src/lib/metrics.ts` (create for future)

- [ ] Create metrics logging structure
  ```typescript
  /**
   * Performance metrics tracking
   * 
   * Track key timing metrics for monitoring and optimization.
   * Future: Send to analytics platform (PostHog, Mixpanel, etc.)
   */
  
  export interface PerformanceMetrics {
    documentId: string;
    timings: {
      azure_duration: number;
      context_question_duration: number;
      question_generation_duration: number;
      qc_duration: number | null;
      total_duration: number;
    };
    stats: {
      page_count: number;
      field_count: number;
      question_count: number;
      qc_skipped: boolean;
      qc_skip_reason?: string;
      avg_confidence: number;
    };
    outcomes: {
      fields_adjusted_by_qc: number;
      fields_added_by_qc: number;
      fields_removed_by_qc: number;
      questions_updated_by_qc: number;
    };
  }
  
  export async function logPerformanceMetrics(metrics: PerformanceMetrics) {
    console.log("[AutoForm] Performance metrics:", metrics);
    
    // TODO: Send to analytics platform
    // await posthog.capture('document_processed', metrics);
  }
  ```

- [ ] Call from orchestrator
  ```typescript
  // At end of processing
  await logPerformanceMetrics({
    documentId,
    timings: { ... },
    stats: { ... },
    outcomes: { ... },
  });
  ```

---

## Success Criteria

After implementing all phases, verify these outcomes:

### Performance Targets

- [ ] ✅ Fields visible in <10s (currently 20-30s)
- [ ] ✅ Context question appears <1s after fields (currently 3-5s)
- [ ] ✅ First question appears <3s after context (currently 10-15s)
- [ ] ✅ All questions delivered <10s after context (currently 20-30s)
- [ ] ✅ 80% of forms skip QC (new capability)

### Functional Requirements

- [ ] ✅ Questions generated from Azure fields work correctly
- [ ] ✅ QC reconciliation adds/removes questions as needed
- [ ] ✅ Realtime streaming shows progressive question loading
- [ ] ✅ Parallel processing handles 5+ page forms
- [ ] ✅ Graceful degradation when AI fails
- [ ] ✅ No increase in error rates

### User Experience

- [ ] ✅ User can start typing immediately after upload
- [ ] ✅ Questions appear progressively (not batched)
- [ ] ✅ Skeleton loaders show processing state
- [ ] ✅ Error messages are helpful and actionable
- [ ] ✅ Form works even if AI fails completely

---

## Rollback Plan

If optimizations cause issues:

### Quick Rollback (Revert Recent Changes)

- [ ] Revert question generation to use vision
  ```typescript
  // In src/lib/gemini/vision.ts
  // Change back to getVisionModel() if Flash has issues
  ```

- [ ] Revert to sequential page processing
  ```typescript
  // In src/lib/orchestrator/page-processor.ts
  // Change Promise.all() back to for loop
  ```

- [ ] Disable optimistic question generation
  ```typescript
  // In src/app/api/documents/[id]/context/route.ts
  // Re-add fields_qc_complete check
  ```

### Full Rollback (Emergency)

- [ ] Git revert the optimization branch
  ```bash
  git revert optimization-branch
  git push origin main
  ```

- [ ] Revert database migrations
  ```bash
  supabase db rollback
  ```

- [ ] Monitor for return to baseline performance

### Partial Rollback (Keep Some Optimizations)

If only one optimization causes issues, selectively revert:

- **Parallel processing issues?** Revert to sequential, keep other changes
- **Optimistic questions issues?** Wait for QC, keep parallel processing
- **Form analysis issues?** Use generic context question, keep other changes

Each optimization is independent and can be reverted separately.

---

## Notes

- This checklist focuses on implementation tasks, not timelines
- Each task has context explaining the "why" behind the decision
- Tasks are ordered by dependency (later phases build on earlier ones)
- Estimated total implementation: 2-3 days of focused work
- Performance improvement: 2-3x faster (20-30s → 5-10s)
- Risk mitigation: Graceful degradation throughout
- User impact: Feels instant, questions stream progressively
