import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/gemini/client";
import type { Profile, Document } from "@/lib/types";

// Build context string from profile and document data
function buildContextString(profile: Profile | null, document: Document | null): string {
  const contextParts: string[] = [];

  if (profile) {
    const { core_data, extended_context } = profile;

    if (core_data.name) {
      contextParts.push(`User's name: ${core_data.name}`);
    }
    if (core_data.email) {
      contextParts.push(`Email: ${core_data.email}`);
    }
    if (core_data.phone) {
      contextParts.push(`Phone: ${core_data.phone}`);
    }
    if (core_data.address) {
      const addr = core_data.address;
      const addressParts = [addr.street, addr.city, addr.state, addr.zip, addr.country]
        .filter(Boolean)
        .join(", ");
      if (addressParts) {
        contextParts.push(`Address: ${addressParts}`);
      }
    }
    if (core_data.date_of_birth) {
      contextParts.push(`Date of birth: ${core_data.date_of_birth}`);
    }
    if (extended_context) {
      contextParts.push(`Additional context: ${extended_context}`);
    }
  }

  if (document?.context_notes) {
    contextParts.push(`Document context: ${document.context_notes}`);
  }

  return contextParts.join("\n");
}

// POST /api/transcribe - Transcribe audio using Gemini with context awareness
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
    const { audio, mimeType, documentId } = body as {
      audio: string; // base64 encoded audio
      mimeType: string;
      documentId?: string; // Optional document context
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
      hasDocumentId: !!documentId,
    });

    // Fetch user profile for context
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Fetch document if provided
    let document: Document | null = null;
    if (documentId) {
      const { data: doc } = await supabase
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .eq("user_id", user.id)
        .single();
      document = doc;
    }

    const contextString = buildContextString(profile, document);
    const hasContext = contextString.length > 0;

    const client = getGeminiClient();

    // Build the transcription prompt with context awareness and cleanup instructions
    const transcriptionPrompt = hasContext
      ? `You are a transcription assistant with context awareness. Transcribe the following audio and apply these rules:

1. **Clean up filler words**: Remove verbal fillers like "um", "uh", "ah", "like", "you know", "sort of", "kind of", "basically", "actually", "literally", "right", "so", "well" when they're used as fillers (not when they're meaningful parts of a sentence).

2. **Use context for correct spelling**: Use the following context to correctly spell names, addresses, and other specific information that the speaker mentions:

<context>
${contextString}
</context>

3. **Preserve meaning**: Don't add or remove any meaningful content - only clean up the filler words and correct spellings.

4. **Return only the cleaned transcription**: No explanations or additional text.

If the audio is unclear or empty, return an empty string.`
      : `Transcribe this audio and clean it up by:
1. Removing filler words like "um", "uh", "ah", "like", "you know", "sort of", "kind of", "basically", "actually", "literally" when used as verbal fillers.
2. Keeping the meaning intact - don't add or remove meaningful content.
3. Return only the cleaned transcription, nothing else.

If the audio is unclear or empty, return an empty string.`;

    // Use Gemini Flash for fast transcription
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: transcriptionPrompt,
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
      hadContext: hasContext,
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
