/**
 * Azure Document Intelligence OCR
 *
 * Extracts full text and word-level polygons from PDF documents using the Read API.
 * Runs in parallel with field extraction to provide:
 * - Document context for question generation (ocr_text)
 * - Word-level positions for coordinate snapping (ocr_pages_data)
 */

import { createAdminClient } from "../supabase/admin";
import type { OcrPageData } from "../coordinate-snapping/types";

const AZURE_ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const AZURE_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

interface OcrResult {
  success: boolean;
  text: string;
  pageCount: number;
  pagesData: OcrPageData[];
  error?: string;
  durationMs: number;
}

interface AnalyzeResponse {
  status: "notStarted" | "running" | "succeeded" | "failed";
  analyzeResult?: {
    content: string;
    pages: Array<{
      pageNumber: number;
      width: number;
      height: number;
      unit: string;
      words?: Array<{
        content: string;
        polygon: number[];
        confidence: number;
      }>;
      lines: Array<{
        content: string;
      }>;
    }>;
  };
}

/**
 * Analyze a specific page range with Azure Document Intelligence Read API.
 * Returns the raw AnalyzeResponse result.
 */
async function analyzePageRange(
  pdfBuffer: ArrayBuffer,
  pageRange: string,
): Promise<AnalyzeResponse> {
  const analyzeUrl = `${AZURE_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&pages=${pageRange}`;

  const submitResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY!,
      "Content-Type": "application/pdf",
    },
    body: pdfBuffer,
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Azure API error: ${submitResponse.status} - ${errorText}`);
  }

  const operationLocation = submitResponse.headers.get("Operation-Location");
  if (!operationLocation) {
    throw new Error("No Operation-Location header in Azure response");
  }

  // Poll for results
  const maxAttempts = 60;
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;

    const pollResponse = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY! },
    });

    if (!pollResponse.ok) {
      throw new Error(`Poll failed: ${pollResponse.status}`);
    }

    const result: AnalyzeResponse = await pollResponse.json();

    if (result.status === "succeeded") return result;
    if (result.status === "failed") throw new Error("Azure analysis failed");
  }

  throw new Error("Analysis timed out");
}

/**
 * Extract text and word-level polygons from a PDF using Azure Document Intelligence Read API.
 *
 * Azure free tier (F0) limits to 2 pages per transaction. For documents with
 * more pages, we split into batches of 2 and run them in parallel, then merge.
 */
export async function extractDocumentText(
  pdfBuffer: ArrayBuffer,
  totalPages?: number,
): Promise<OcrResult> {
  const startTime = Date.now();

  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    return {
      success: false,
      text: "",
      pageCount: 0,
      pagesData: [],
      error: "Azure Document Intelligence not configured",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Build page ranges — 2 pages per batch (free tier limit)
    const PAGES_PER_BATCH = 2;
    const numPages = totalPages || 1;
    const pageRanges: string[] = [];
    for (let start = 1; start <= numPages; start += PAGES_PER_BATCH) {
      const end = Math.min(start + PAGES_PER_BATCH - 1, numPages);
      pageRanges.push(`${start}-${end}`);
    }

    console.log("[AutoForm] Azure OCR batches:", { pageRanges, totalPages: numPages });

    // Run all batches in parallel
    const batchResults = await Promise.allSettled(
      pageRanges.map((range) => analyzePageRange(pdfBuffer, range)),
    );

    // Merge results from all batches
    let allText = "";
    const allPagesData: OcrPageData[] = [];
    let totalPagesProcessed = 0;

    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      if (result.status === "rejected") {
        console.error(`[AutoForm] Azure OCR batch ${pageRanges[i]} failed:`, result.reason);
        continue;
      }
      const response = result.value;
      if (!response.analyzeResult) continue;

      allText += (allText ? "\n" : "") + (response.analyzeResult.content || "");
      const pages = response.analyzeResult.pages || [];
      totalPagesProcessed += pages.length;

      for (const page of pages) {
        allPagesData.push({
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          unit: page.unit || "inch",
          words: (page.words || []).map((word) => ({
            content: word.content,
            polygon: word.polygon || [],
            confidence: word.confidence ?? 0,
          })),
        });
      }
    }

    // Sort by page number (batches may resolve out of order)
    allPagesData.sort((a, b) => a.pageNumber - b.pageNumber);

    return {
      success: true,
      text: allText,
      pageCount: totalPagesProcessed,
      pagesData: allPagesData,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[AutoForm] Azure OCR error:", error);
    return {
      success: false,
      text: "",
      pageCount: 0,
      pagesData: [],
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Run OCR and save results to database
 * Called in parallel with field extraction
 */
export async function runOcrAndSave(documentId: string, pdfBuffer: ArrayBuffer): Promise<void> {
  const supabase = createAdminClient();

  console.log("[AutoForm] Starting Azure OCR:", { documentId });

  // Get page count from PDF to request all pages explicitly
  let totalPages = 1;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    totalPages = pdfDoc.getPageCount();
  } catch (e) {
    console.warn("[AutoForm] Could not read PDF page count, defaulting to 1:", e);
  }

  const result = await extractDocumentText(pdfBuffer, totalPages);

  if (result.success) {
    console.log("[AutoForm] Azure OCR complete:", {
      documentId,
      textLength: result.text.length,
      pageCount: result.pageCount,
      wordsPerPage: result.pagesData.map((p) => p.words.length),
      durationMs: result.durationMs,
    });

    // Save OCR text and word-level data to database
    await supabase
      .from("documents")
      .update({
        ocr_text: result.text,
        ocr_pages_data: result.pagesData,
        ocr_completed_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } else {
    console.error("[AutoForm] Azure OCR failed:", {
      documentId,
      error: result.error,
      durationMs: result.durationMs,
    });

    // Still mark as completed (with empty text) so question generation doesn't wait forever
    await supabase
      .from("documents")
      .update({
        ocr_text: "",
        ocr_pages_data: null,
        ocr_completed_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  }
}

/**
 * Wait for OCR to complete (for question generation)
 * Returns the OCR text or empty string if timeout
 */
export async function waitForOcr(documentId: string, maxWaitMs: number = 30000): Promise<string> {
  const supabase = createAdminClient();
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { data } = await supabase
      .from("documents")
      .select("ocr_text, ocr_completed_at")
      .eq("id", documentId)
      .single();

    if (data?.ocr_completed_at) {
      return data.ocr_text || "";
    }

    // Wait 500ms before checking again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn("[AutoForm] OCR wait timeout:", { documentId, maxWaitMs });
  return "";
}

/**
 * Try to get OCR word-level data if available (non-blocking).
 * Returns null if OCR hasn't completed yet.
 */
export async function getOcrPagesData(documentId: string): Promise<OcrPageData[] | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("documents")
    .select("ocr_pages_data, ocr_completed_at")
    .eq("id", documentId)
    .single();

  if (!data?.ocr_completed_at || !data.ocr_pages_data) {
    return null;
  }

  return data.ocr_pages_data as OcrPageData[];
}
