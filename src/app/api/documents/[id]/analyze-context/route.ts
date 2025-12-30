import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/storage";
import { analyzeFormFromAzure } from "@/lib/form-analysis";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExtractedField } from "@/lib/types";

// GET /api/documents/[id]/analyze-context - Get tailored context question
//
// SPEED OPTIMIZATION: No longer uses Gemini Vision!
// Instead, infers form type from Azure field labels (instant).
// 3-5s -> <100ms
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

    // Analyze form from Azure fields (NO VISION CALL - instant!)
    const analysis = analyzeFormFromAzure(fields as ExtractedField[]);

    console.log("[AutoForm] Form analysis (from Azure fields, no vision):", {
      documentId,
      formType: analysis.type,
      matchedKeywords: analysis.keywords.length,
      contextQuestion: analysis.contextQuestion.substring(0, 50) + "...",
    });

    // Cache the question in the document
    await adminClient
      .from("documents")
      .update({ tailored_context_question: analysis.contextQuestion })
      .eq("id", documentId);

    return NextResponse.json({
      question: analysis.contextQuestion,
      formType: analysis.type,
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
