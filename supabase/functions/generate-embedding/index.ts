// Edge Function for generating embeddings using Supabase's built-in gte-small model
// This function generates 384-dimensional embeddings for entity matching and semantic search

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Initialize the embedding model session (reused across requests)
const model = new Supabase.ai.Session("gte-small");

interface EmbeddingRequest {
  texts: string[];
}

interface EmbeddingResponse {
  embeddings: number[][];
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const { texts }: EmbeddingRequest = await req.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(
        JSON.stringify({ error: "texts array is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Limit batch size to prevent timeout
    if (texts.length > 50) {
      return new Response(
        JSON.stringify({ error: "Maximum 50 texts per request" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Generate embeddings for all texts
    const embeddings = await Promise.all(
      texts.map(async (text) => {
        const embedding = await model.run(text, {
          mean_pool: true,
          normalize: true,
        });
        // Convert Float32Array to regular array for JSON serialization
        return Array.from(embedding as Float32Array);
      })
    );

    const response: EmbeddingResponse = { embeddings };

    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Embedding generation error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to generate embeddings",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
