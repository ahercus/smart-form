// Embedding generation utilities for entity matching and semantic search
// Uses Supabase Edge Function with built-in gte-small model (384 dimensions)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface EmbeddingResponse {
  embeddings: number[][];
  error?: string;
}

/**
 * Generate embeddings for one or more texts using Supabase Edge Function
 * Uses gte-small model which produces 384-dimensional normalized vectors
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  // Filter out empty strings
  const validTexts = texts.filter((t) => t.trim().length > 0);
  if (validTexts.length === 0) {
    return texts.map(() => []);
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-embedding`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ texts: validTexts }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
    }

    const data: EmbeddingResponse = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Map back to original array positions (empty strings get empty arrays)
    let validIndex = 0;
    return texts.map((t) => {
      if (t.trim().length === 0) {
        return [];
      }
      return data.embeddings[validIndex++];
    });
  } catch (error) {
    console.error("[AutoForm] Failed to generate embeddings:", error);
    // Return empty arrays on failure - extraction can still proceed without embeddings
    return texts.map(() => []);
  }
}

/**
 * Generate a single embedding for a text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding || [];
}

/**
 * Calculate cosine similarity between two normalized vectors
 * Since our vectors are normalized, this is equivalent to dot product
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct;
}
