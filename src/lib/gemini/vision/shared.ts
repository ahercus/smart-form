import { writeFile, mkdir } from "fs/promises";
import path from "path";
import type { FieldReviewResult } from "./types";

const DEBUG_SAVE_IMAGES = process.env.DEBUG_QC_IMAGES === "true";
const DEBUG_DIR = "/tmp/autoform-qc-debug";

export async function saveDebugImage(imageBase64: string, filename: string): Promise<void> {
  if (!DEBUG_SAVE_IMAGES) return;
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const filepath = path.join(DEBUG_DIR, filename);
    await writeFile(filepath, Buffer.from(imageBase64, "base64"));
    console.log(`[AutoForm] DEBUG: Saved image to ${filepath}`);
  } catch (err) {
    console.error(`[AutoForm] DEBUG: Failed to save image:`, err);
  }
}

export function parseFieldReviewResponse(text: string): FieldReviewResult {
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
      adjustments: parsed.adjustments || [],
      newFields: parsed.newFields || [],
      removeFields: parsed.removeFields || [],
      fieldsValidated: parsed.fieldsValidated ?? true,
    };
  } catch (error) {
    console.error("[AutoForm] Failed to parse field review response:", {
      error,
      text: cleaned.slice(0, 500),
    });
    return {
      adjustments: [],
      newFields: [],
      removeFields: [],
      fieldsValidated: false,
    };
  }
}
