import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/gemini/client";

// POST /api/transcribe - Transcribe audio using Gemini
export async function POST(request: NextRequest) {
  // Verify authentication
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { audio, mimeType } = body as {
      audio: string; // base64 encoded audio
      mimeType: string;
    };

    if (!audio || !mimeType) {
      return NextResponse.json(
        { error: "Missing audio data or mimeType" },
        { status: 400 }
      );
    }

    console.log("[AutoForm] Transcribing audio:", {
      mimeType,
      audioLength: audio.length,
    });

    const client = getGeminiClient();

    // Use Gemini Flash for fast transcription
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else. If the audio is unclear or empty, return an empty string.",
            },
            {
              inlineData: {
                mimeType: mimeType,
                data: audio,
              },
            },
          ],
        },
      ],
    });

    const transcribedText = response.text?.trim() || "";

    console.log("[AutoForm] Transcription complete:", {
      textLength: transcribedText.length,
      preview: transcribedText.substring(0, 50),
    });

    return NextResponse.json({ text: transcribedText });
  } catch (error) {
    console.error("[AutoForm] Transcription error:", error);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 }
    );
  }
}
