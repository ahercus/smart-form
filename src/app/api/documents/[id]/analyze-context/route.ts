import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateFast, withTimeout } from "@/lib/gemini/client";

// GET /api/documents/[id]/analyze-context - Get tailored context question
//
// Sends Azure extracted fields to Gemini Flash to craft a tailored context question.
// ~1-2s (faster than vision, but smarter than keyword matching)
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

    // Get fields from database (Azure already extracted them)
    const adminClient = createAdminClient();
    const { data: fields } = await adminClient
      .from("extracted_fields")
      .select("*")
      .eq("document_id", documentId)
      .is("deleted_at", null);

    if (!fields || fields.length === 0) {
      // Return generic question if no fields yet
      return NextResponse.json({
        question:
          "Share any context about this form - who it's for, important details, or preferences.",
        cached: false,
        fallback: true,
      });
    }

    // Build prompt with Azure field data for Gemini
    const fieldSummary = fields
      .map((f) => `- ${f.label} (${f.field_type})`)
      .join("\n");

    const prompt = `You are helping a user fill out a form. Based on the extracted fields below, craft a single, concise context question to help understand who this form is for and any important details.

EXTRACTED FIELDS:
${fieldSummary}

INSTRUCTIONS:
- Analyze the field labels to understand what type of form this is
- Ask ONE specific question that would help gather context
- Keep it under 2 sentences
- Be conversational and friendly
- Focus on the most important context that would help fill out this specific form

Return ONLY the question text, nothing else.`;

    // Call Gemini Flash (text-only, fast)
    const contextQuestion = await withTimeout(
      generateFast({ prompt }),
      10000, // 10s timeout
      "Context question generation"
    );

    const trimmedQuestion = contextQuestion.trim();

    console.log("[AutoForm] Context question generated (Gemini Flash):", {
      documentId,
      fieldCount: fields.length,
      question: trimmedQuestion.substring(0, 80) + "...",
    });

    // Cache the question in the document
    await adminClient
      .from("documents")
      .update({ tailored_context_question: trimmedQuestion })
      .eq("id", documentId);

    return NextResponse.json({
      question: trimmedQuestion,
      cached: false,
    });
  } catch (error) {
    console.error("[AutoForm] Analyze context error:", error);
    // Return generic question on error
    return NextResponse.json({
      question:
        "Share any context about this form - who it's for, important details, or preferences.",
      fallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
