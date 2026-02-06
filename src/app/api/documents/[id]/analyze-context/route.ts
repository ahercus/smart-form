import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getPageImageBase64 } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateWithVisionFast, withTimeout } from "@/lib/gemini/client";

// Generic fallback question when first page has no useful context
const GENERIC_CONTEXT_QUESTION =
  "Share any context about this form - who it's for, important details, or preferences.";

// GET /api/documents/[id]/analyze-context - Get tailored context question
//
// Uses Gemini Vision on the FIRST page only to quickly craft a tailored context question.
// Much faster than waiting for field extraction to complete.
export async function GET(
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
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Check if we already have a cached tailored question
    if (document.tailored_context_question) {
      return NextResponse.json({
        question: document.tailored_context_question,
        cached: true,
      });
    }

    // Get page images from document
    const pageImages = document.page_images || [];
    if (pageImages.length === 0) {
      // No page images yet - return generic question
      return NextResponse.json({
        question: GENERIC_CONTEXT_QUESTION,
        cached: false,
        fallback: true,
        reason: "no_page_images",
      });
    }

    // Get ONLY the first page image
    const firstPage = pageImages.find((p: { page: number; storage_path: string }) => p.page === 1);
    if (!firstPage) {
      return NextResponse.json({
        question: GENERIC_CONTEXT_QUESTION,
        cached: false,
        fallback: true,
        reason: "no_first_page",
      });
    }

    let firstPageBase64: string;
    try {
      firstPageBase64 = await getPageImageBase64(firstPage.storage_path);
    } catch (error) {
      console.error("[AutoForm] Failed to load first page image:", error);
      return NextResponse.json({
        question: GENERIC_CONTEXT_QUESTION,
        cached: false,
        fallback: true,
        reason: "image_load_failed",
      });
    }

    // Build prompt - tell Gemini it's only seeing the first page
    const isMultiPage = pageImages.length > 1;
    const prompt = buildContextQuestionPrompt(isMultiPage, pageImages.length);

    console.log("[AutoForm] Analyzing first page for context question:", {
      documentId,
      totalPages: pageImages.length,
      isMultiPage,
    });

    // Call Gemini Vision on first page only
    const imagePart = {
      inlineData: {
        data: firstPageBase64,
        mimeType: "image/png",
      },
    };

    const responseText = await withTimeout(
      generateWithVisionFast({
        prompt,
        imageParts: [imagePart],
        jsonOutput: true,
        responseSchema: contextQuestionSchema,
      }),
      10000, // 10s timeout
      "Context question generation"
    );

    const { question, hasUsefulContext } = parseContextQuestionResponse(responseText);

    // If first page has no useful context (cover page, etc.), use generic question
    if (!hasUsefulContext) {
      console.log("[AutoForm] First page has no useful context, using generic question:", {
        documentId,
      });

      const adminClient = createAdminClient();
      await adminClient
        .from("documents")
        .update({ tailored_context_question: GENERIC_CONTEXT_QUESTION })
        .eq("id", documentId);

      return NextResponse.json({
        question: GENERIC_CONTEXT_QUESTION,
        cached: false,
        fallback: true,
        reason: "cover_page",
      });
    }

    console.log("[AutoForm] Context question generated (first page vision):", {
      documentId,
      question: question.substring(0, 80) + "...",
    });

    // Cache the question in the document
    const adminClient = createAdminClient();
    await adminClient
      .from("documents")
      .update({ tailored_context_question: question })
      .eq("id", documentId);

    return NextResponse.json({
      question,
      cached: false,
    });
  } catch (error) {
    console.error("[AutoForm] Analyze context error:", error);
    // Return generic question on error
    return NextResponse.json({
      question: GENERIC_CONTEXT_QUESTION,
      fallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Build prompt for context question generation
 */
function buildContextQuestionPrompt(isMultiPage: boolean, totalPages: number): string {
  const multiPageContext = isMultiPage
    ? `\n\nNOTE: This is a ${totalPages}-page document. You are only seeing the FIRST page. Base your question on what you can see, but keep in mind there may be more form fields on subsequent pages.`
    : "";

  return `You are helping a user fill out a PDF form. Look at this form page and craft a single, concise question to help understand who this form is for and gather important context.

## Your Task

1. Analyze the visible form to understand what type of form this is
2. Determine if this page has enough context to ask a specific question
3. If this appears to be a cover page, title page, or page with no form fields, indicate that
4. If there ARE form fields visible, craft a specific question about who this form is for

## Response Format
Return ONLY valid JSON:
{
  "question": "Your tailored question here",
  "hasUsefulContext": true,
  "formType": "school enrollment"
}

## Guidelines
- Keep the question under 2 sentences
- Be conversational and friendly
- Focus on the most important context that would help fill out this specific form
- If asking about a person the form is for (student, patient, child, etc.), ask about them specifically
- hasUsefulContext should be false if this appears to be a cover page or has no form fields${multiPageContext}

Return ONLY the JSON object, nothing else.`;
}

/**
 * Schema for context question response
 */
const contextQuestionSchema = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The tailored context question to ask the user",
    },
    hasUsefulContext: {
      type: "boolean",
      description: "Whether the page has enough context to generate a useful question",
    },
    formType: {
      type: "string",
      description: "Type of form detected (e.g., 'school enrollment', 'medical history')",
    },
  },
  required: ["question", "hasUsefulContext"],
};

/**
 * Parse context question response
 */
function parseContextQuestionResponse(text: string): {
  question: string;
  hasUsefulContext: boolean;
  formType?: string;
} {
  // Clean up markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      question: parsed.question || GENERIC_CONTEXT_QUESTION,
      hasUsefulContext: parsed.hasUsefulContext !== false, // default to true
      formType: parsed.formType,
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse context question response:", {
      error,
      text: cleaned.slice(0, 200),
    });
    return {
      question: GENERIC_CONTEXT_QUESTION,
      hasUsefulContext: true, // assume useful on parse error, will use generic as fallback
    };
  }
}
