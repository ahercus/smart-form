import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getPageImageBase64 } from "@/lib/storage";
import { generateWithVision } from "@/lib/gemini/client";
import { ThinkingLevel } from "@google/genai";

// GET /api/documents/[id]/analyze-context - Get tailored context question
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

    // Get first page image
    const pageImages = document.page_images || [];
    const firstPage = pageImages.find((p: { page: number }) => p.page === 1);

    if (!firstPage) {
      // Return generic question if no image available yet
      return NextResponse.json({
        question: "Share any context about this form - who it's for, important details, or preferences.",
        cached: false,
        fallback: true,
      });
    }

    // Get the image as base64
    const imageBase64 = await getPageImageBase64(firstPage.storage_path);

    if (!imageBase64) {
      return NextResponse.json({
        question: "Share any context about this form - who it's for, important details, or preferences.",
        cached: false,
        fallback: true,
      });
    }

    // Call Gemini with LOW thinking for fast context question generation
    const prompt = `You are looking at the first page of a PDF form. In ONE short sentence, ask the user for context that would help fill out this specific form.

Be specific to what you see - mention the type of form (health form, school enrollment, tax form, etc.) and ask for the most relevant information.

Examples:
- For a health form: "Who is this health form for and do they have any medical conditions or allergies?"
- For a school enrollment: "Which child is being enrolled and what grade are they entering?"
- For a job application: "What position are you applying for and what's your relevant experience?"

RESPOND WITH ONLY THE QUESTION - no explanation, no quotes, just the question text.`;

    const tailoredQuestion = await generateWithVision({
      prompt,
      imageParts: [
        {
          inlineData: {
            data: imageBase64,
            mimeType: "image/png",
          },
        },
      ],
      thinkingLevel: ThinkingLevel.LOW,
    });

    const trimmedQuestion = tailoredQuestion.trim();

    // Cache the question in the document (fire and forget)
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const adminClient = createAdminClient();
    (async () => {
      const { error } = await adminClient
        .from("documents")
        .update({ tailored_context_question: trimmedQuestion })
        .eq("id", documentId);
      if (error) {
        console.error("[AutoForm] Failed to cache context question:", error);
      } else {
        console.log("[AutoForm] Cached tailored context question");
      }
    })();

    console.log("[AutoForm] Generated tailored context question:", {
      documentId,
      question: trimmedQuestion.substring(0, 50) + "...",
    });

    return NextResponse.json({
      question: trimmedQuestion,
      cached: false,
    });
  } catch (error) {
    console.error("[AutoForm] Analyze context error:", error);
    // Return generic question on error
    return NextResponse.json({
      question: "Share any context about this form - who it's for, important details, or preferences.",
      fallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
