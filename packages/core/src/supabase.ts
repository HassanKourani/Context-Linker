import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared Supabase backend — all ctx-link cloud bundles go here.
// Bundle-level access control is via argon2 tokens, not Supabase auth.
const SUPABASE_URL = "https://xezkzgxrkwqfilglrdww.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhlemt6Z3hya3dxZmlsZ2xyZHd3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg3NTA0MSwiZXhwIjoyMDkyNDUxMDQxfQ.WLBNKiWmY63tQxxc6QklYBWiHLpEwedrLYC-PNC-4bw";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  return cached;
}
