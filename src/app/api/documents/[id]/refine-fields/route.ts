import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getFile, getPageImageBase64, setPageFields, updateDocument } from "@/lib/storage";
import { extractFieldsFromAllPages } from "@/lib/orchestrator/single-page-extraction";
import { generateQuestions } from "@/lib/orchestrator/question-generator";
import { getOcrPagesData } from "@/lib/azure/ocr";
import { ocrPageDataToWords, extractAcroFormFields } from "@/lib/coordinate-snapping";
import type { OcrWordWithCoords, AcroFormField } from "@/lib/coordinate-snapping";

/**
 * POST /api/documents/[id]/refine-fields
 *
 * Extract fields from document pages using Gemini Vision.
 *
 * Optimized pipeline:
 * - Single Gemini Flash call per page (no quadrants, no Azure)
 * - ~10 seconds per page
 * - 94% detection, 69% IoU accuracy
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  try {
    let clientDateTime: string | undefined;
    let clientTimeZone: string | undefined;
    let clientTimeZoneOffsetMinutes: number | undefined;

    try {
      const body = await request.json();
      clientDateTime = body?.clientDateTime;
      clientTimeZone = body?.clientTimeZone;
      clientTimeZoneOffsetMinutes = body?.clientTimeZoneOffsetMinutes;
    } catch {
      // No JSON body provided
    }

    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Check if already refined
    if (document.fields_qc_complete) {
      console.log("[AutoForm] Fields already extracted, skipping:", { documentId });
      return NextResponse.json({
        success: true,
        message: "Fields already extracted",
        cached: true,
      });
    }

    // Get page images
    const pageImages = document.page_images || [];
    if (pageImages.length === 0) {
      console.log("[AutoForm] No page images available:", { documentId });
      return NextResponse.json({
        success: false,
        error: "No page images available",
      }, { status: 400 });
    }

    // Load page images as base64
    const pageImagesWithData = await Promise.all(
      pageImages.map(async (p: { page: number; storage_path: string }) => ({
        pageNumber: p.page,
        imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
      }))
    );

    // Filter out pages without images
    const validPageImages = pageImagesWithData.filter((p) => p.imageBase64);

    if (validPageImages.length === 0) {
      console.log("[AutoForm] No valid page images:", { documentId });
      return NextResponse.json({
        success: false,
        error: "Failed to load page images",
      }, { status: 500 });
    }

    // Load PDF buffer and OCR data in parallel for coordinate snapping
    // PDF buffer is needed for vector line extraction; OCR data for label-based snapping
    // Both run during Gemini's ~10s extraction, adding ~0ms net latency
    let pdfBuffer: Buffer | undefined;
    let ocrWordsByPage: Map<number, OcrWordWithCoords[]> | undefined;

    try {
      const [pdfArrayBuffer, ocrPagesData] = await Promise.all([
        document.storage_path
          ? getFile(document.storage_path)
          : Promise.resolve(null),
        getOcrPagesData(documentId),
      ]);

      if (pdfArrayBuffer) {
        pdfBuffer = Buffer.from(pdfArrayBuffer);
      }

      if (ocrPagesData && ocrPagesData.length > 0) {
        ocrWordsByPage = new Map();
        for (const pageData of ocrPagesData) {
          ocrWordsByPage.set(pageData.pageNumber, ocrPageDataToWords(pageData));
        }
        console.log("[AutoForm] OCR data loaded for snapping:", {
          documentId,
          pages: ocrPagesData.length,
          wordsPerPage: ocrPagesData.map((p) => p.words.length),
        });
      }
    } catch (err) {
      console.warn("[AutoForm] Failed to load snapping data, continuing without:", err instanceof Error ? err.message : err);
    }

    // Extract AcroForm fields from PDF (if available)
    // These provide mathematically exact coordinates for embedded form fields
    let acroFormFieldsByPage: Map<number, AcroFormField[]> | undefined;

    if (pdfBuffer) {
      try {
        const acroFormResult = await extractAcroFormFields(pdfBuffer);
        if (acroFormResult.hasAcroForm) {
          acroFormFieldsByPage = acroFormResult.fieldsByPage;
          console.log("[AutoForm] AcroForm fields extracted:", {
            documentId,
            fieldCount: acroFormResult.fields.length,
            pages: acroFormResult.fieldsByPage.size,
            durationMs: acroFormResult.durationMs,
          });
        }
      } catch (err) {
        console.warn("[AutoForm] AcroForm extraction failed, continuing without:", err instanceof Error ? err.message : err);
      }
    }

    console.log("[AutoForm] Starting field extraction:", {
      documentId,
      pageCount: validPageImages.length,
      hasSnapping: !!pdfBuffer,
      hasOcrWords: !!ocrWordsByPage,
      hasAcroForm: !!acroFormFieldsByPage,
    });

    let pagesCompleted = 0;
    let totalFields = 0;

    // Extract fields from all pages
    const extractionResults = await extractFieldsFromAllPages({
      documentId,
      pageImages: validPageImages,
      pdfBuffer,
      ocrWordsByPage,
      acroFormFieldsByPage,
      // Progressive reveal: save fields as each page completes
      onPageComplete: async (pageResult) => {
        pagesCompleted++;
        totalFields += pageResult.fields.length;

        console.log("[AutoForm] Page extraction complete:", {
          documentId,
          pageNumber: pageResult.pageNumber,
          fieldsFound: pageResult.fields.length,
          durationMs: pageResult.durationMs,
          pagesCompleted,
          totalPages: validPageImages.length,
        });

        // Save this page's fields to database immediately
        await setPageFields(documentId, pageResult.pageNumber, pageResult.fields);
      },
    });

    // Calculate total duration
    const totalDurationMs = extractionResults.reduce((sum, r) => sum + r.durationMs, 0);

    // Mark extraction complete and document ready
    await updateDocument(documentId, {
      fields_qc_complete: true,
      status: "ready",
    });

    console.log("[AutoForm] Field extraction complete:", {
      documentId,
      totalFields,
      totalDurationMs,
    });

    // Trigger question generation if context already submitted
    const freshDoc = await getDocument(documentId);
    let questionsGenerated = 0;

    if (freshDoc?.context_submitted) {
      console.log("[AutoForm] Context already submitted, generating questions:", { documentId });

      try {
        const result = await generateQuestions({
          documentId,
          userId: user.id,
          pageImages: validPageImages,
          useMemory: freshDoc.use_memory ?? true,
          clientDateTime,
          clientTimeZone,
          clientTimeZoneOffsetMinutes,
        });
        questionsGenerated = result.questionsGenerated;

        console.log("[AutoForm] Questions generated:", {
          documentId,
          questionsGenerated,
        });
      } catch (err) {
        console.error("[AutoForm] Question generation failed:", err);
      }
    } else {
      console.log("[AutoForm] Context not yet submitted, questions will generate on context submit:", { documentId });
    }

    return NextResponse.json({
      success: true,
      fieldsExtracted: totalFields,
      questionsGenerated,
      pageResults: extractionResults.map((r) => ({
        pageNumber: r.pageNumber,
        fieldsFound: r.fields.length,
        durationMs: r.durationMs,
      })),
    });
  } catch (error) {
    console.error("[AutoForm] Field extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract fields" },
      { status: 500 }
    );
  }
}
