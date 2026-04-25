import { getSupabase } from "./supabase.js";

/**
 * Record an entry as excluded from a bundle.
 * Auto-sync will skip excluded entries.
 */
export async function excludeEntryFromBundle(
  bundleId: string,
  entryId: string,
  machineId?: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("excluded_entry_refs")
    .upsert({ bundle_id: bundleId, entry_id: entryId, excluded_by_machine_id: machineId ?? null });
  if (error) throw new Error(`excludeEntryFromBundle failed: ${error.message}`);
}

/**
 * Re-include a previously excluded entry.
 */
export async function includeEntryInBundle(
  bundleId: string,
  entryId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("excluded_entry_refs")
    .delete()
    .eq("bundle_id", bundleId)
    .eq("entry_id", entryId);
  if (error) throw new Error(`includeEntryInBundle failed: ${error.message}`);
}

/**
 * Get all excluded entry IDs for a bundle.
 */
export async function getExcludedEntryIds(bundleId: string): Promise<Set<string>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("excluded_entry_refs")
    .select("entry_id")
    .eq("bundle_id", bundleId);
  if (error) throw new Error(`getExcludedEntryIds failed: ${error.message}`);
  return new Set((data ?? []).map((r: any) => r.entry_id));
}
