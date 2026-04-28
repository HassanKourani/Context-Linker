import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileAuthStorage } from "./auth-storage.js";

// Public Supabase URL — safe to ship.
const HARDCODED_URL = "https://xezkzgxrkwqfilglrdww.supabase.co";

// Publishable API key — safe to ship. Identifies the project; access control
// is enforced by RLS policies (see migration 0011_auth_rls.sql) keyed off the
// signed-in user's auth.uid().
//
// Override at runtime with CTX_LINK_SUPABASE_ANON_KEY (useful for local
// Supabase dev / staging projects).
const HARDCODED_ANON_KEY = "sb_publishable_uoSoyWl_Mxqa3kzkJuGatA_e86f2D3L";

const SUPABASE_URL = process.env.CTX_LINK_SUPABASE_URL ?? HARDCODED_URL;
const SUPABASE_ANON_KEY =
  process.env.CTX_LINK_SUPABASE_ANON_KEY ?? HARDCODED_ANON_KEY;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Persist the access + refresh token to ~/.ctx-link/auth.json so the
      // CLI, MCP server, and UI server share a single signed-in user.
      storage: fileAuthStorage,
      persistSession: true,
      autoRefreshToken: true,
      // No URL fragment in Node — UI handles its own redirect-callback case.
      detectSessionInUrl: false,
    },
  });
  return cached;
}
