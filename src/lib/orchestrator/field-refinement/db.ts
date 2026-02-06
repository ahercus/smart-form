import type { SupabaseClient } from "@supabase/supabase-js";

export type FieldAdjustment = { fieldId: string; updateData: Record<string, unknown> };

export async function applyAdjustments(
  client: SupabaseClient,
  adjustments: FieldAdjustment[]
): Promise<number> {
  let totalAdjusted = 0;
  if (adjustments.length === 0) return totalAdjusted;

  const promises = adjustments.map(async ({ fieldId, updateData }) => {
    await client.from("extracted_fields").update(updateData).eq("id", fieldId);
    totalAdjusted++;
  });
  await Promise.all(promises);
  return totalAdjusted;
}

export async function insertNewFields(
  client: SupabaseClient,
  rows: Array<Record<string, unknown>>
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await client.from("extracted_fields").insert(rows);
  if (error) {
    console.error("[AutoForm] Batch insert error:", error);
    return 0;
  }
  return rows.length;
}

export async function softDeleteFields(
  client: SupabaseClient,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  await client
    .from("extracted_fields")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  return ids.length;
}
