import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadGlobalConfig } from "./config.js";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const cfg = loadGlobalConfig();
  if (!cfg.supabase) {
    throw new Error("ctx-link: supabase not configured. Run 'ctx-link init'.");
  }
  cached = createClient(cfg.supabase.url, cfg.supabase.service_role_key, {
    auth: { persistSession: false },
  });
  return cached;
}
