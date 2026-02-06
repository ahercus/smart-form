// Background entity extraction endpoint
// Called after a user answers a question (fire-and-forget)
// Extracts entities, facts, and relationships from the answer

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractEntitiesFromAnswer } from "@/lib/memory/extraction";

interface ExtractRequest {
  question: string;
  answer: string;
  documentId?: string;
}

/**
 * POST /api/memories/extract
 *
 * Background endpoint for extracting entities from form answers.
 * Called without await from the question answer flow for non-blocking processing.
 *
 * The endpoint returns immediately with 202 Accepted while extraction runs.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: ExtractRequest = await request.json();
    const { question, answer, documentId } = body;

    if (!question || !answer) {
      return NextResponse.json(
        { error: "question and answer are required" },
        { status: 400 }
      );
    }

    // Skip extraction for very short or non-informative answers
    if (answer.trim().length < 2) {
      return NextResponse.json({ status: "skipped", reason: "answer too short" });
    }

    // Skip yes/no/boolean answers - they don't contain extractable info
    const lowerAnswer = answer.toLowerCase().trim();
    if (["yes", "no", "true", "false", "n/a", "na", "none"].includes(lowerAnswer)) {
      return NextResponse.json({ status: "skipped", reason: "boolean answer" });
    }

    console.log("[AutoForm] Starting background entity extraction:", {
      userId: user.id,
      questionPreview: question.slice(0, 50),
      answerPreview: answer.slice(0, 50),
      documentId,
    });

    // Run extraction - don't await, let it run in the background
    // Next.js will keep the serverless function alive until it completes
    extractEntitiesFromAnswer(user.id, question, answer, documentId || null)
      .then(() => {
        console.log("[AutoForm] Background extraction completed successfully");
      })
      .catch((error) => {
        console.error("[AutoForm] Background extraction failed:", error);
      });

    // Return immediately with 202 Accepted
    return NextResponse.json(
      { status: "accepted", message: "Extraction started" },
      { status: 202 }
    );
  } catch (error) {
    console.error("[AutoForm] Extract endpoint error:", error);
    return NextResponse.json(
      { error: "Failed to start extraction" },
      { status: 500 }
    );
  }
}
