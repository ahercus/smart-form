/**
 * Azure Document Intelligence OCR
 *
 * Extracts full text from PDF documents using the Read API.
 * Runs in parallel with field extraction to provide document context
 * for the question writer agent.
 */

import { createAdminClient } from "../supabase/admin";

const AZURE_ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const AZURE_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

interface OcrResult {
  success: boolean;
  text: string;
  pageCount: number;
  error?: string;
  durationMs: number;
}

interface AnalyzeResponse {
  status: "notStarted" | "running" | "succeeded" | "failed";
  analyzeResult?: {
    content: string;
    pages: Array<{
      pageNumber: number;
      lines: Array<{
        content: string;
      }>;
    }>;
  };
}

/**
 * Extract text from a PDF using Azure Document Intelligence Read API
 */
export async function extractDocumentText(pdfBuffer: ArrayBuffer): Promise<OcrResult> {
  const startTime = Date.now();

  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    return {
      success: false,
      text: "",
      pageCount: 0,
      error: "Azure Document Intelligence not configured",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Submit document for analysis
    const analyzeUrl = `${AZURE_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;

    const submitResponse = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/pdf",
      },
      body: pdfBuffer,
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Azure API error: ${submitResponse.status} - ${errorText}`);
    }

    // Get the operation location from headers
    const operationLocation = submitResponse.headers.get("Operation-Location");
    if (!operationLocation) {
      throw new Error("No Operation-Location header in Azure response");
    }

    // Poll for results
    let result: AnalyzeResponse | null = null;
    const maxAttempts = 60; // 60 seconds max wait
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;

      const pollResponse = await fetch(operationLocation, {
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_KEY,
        },
      });

      if (!pollResponse.ok) {
        throw new Error(`Poll failed: ${pollResponse.status}`);
      }

      result = await pollResponse.json();

      if (result?.status === "succeeded") {
        break;
      } else if (result?.status === "failed") {
        throw new Error("Azure analysis failed");
      }
      // Continue polling for "notStarted" and "running"
    }

    if (!result?.analyzeResult) {
      throw new Error("Analysis timed out or returned no results");
    }

    // Extract full text content
    const text = result.analyzeResult.content || "";
    const pageCount = result.analyzeResult.pages?.length || 0;

    return {
      success: true,
      text,
      pageCount,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[AutoForm] Azure OCR error:", error);
    return {
      success: false,
      text: "",
      pageCount: 0,
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

  const result = await extractDocumentText(pdfBuffer);

  if (result.success) {
    console.log("[AutoForm] Azure OCR complete:", {
      documentId,
      textLength: result.text.length,
      pageCount: result.pageCount,
      durationMs: result.durationMs,
    });

    // Save OCR text to database
    await supabase
      .from("documents")
      .update({
        ocr_text: result.text,
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
