import { randomBytes } from "node:crypto";
import { getSupabase } from "./supabase.js";

const CODE_PREFIX = "ctx-";
const CODE_LENGTH = 6;
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateShortCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `${CODE_PREFIX}${code}`;
}

export async function createJoinCode(
  bundleId: string,
  token: string,
  expiryDays = 7,
): Promise<string> {
  const sb = getSupabase();
  let code: string;
  let attempts = 0;
  while (true) {
    code = generateShortCode();
    const { data: existing } = await sb
      .from("bundle_join_codes")
      .select("code")
      .eq("code", code)
      .limit(1);
    if (!existing || existing.length === 0) break;
    attempts++;
    if (attempts > 10) throw new Error("Failed to generate unique join code.");
  }
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await sb
    .from("bundle_join_codes")
    .insert({ code, bundle_id: bundleId, token, expires_at: expiresAt });
  if (error) throw new Error(`createJoinCode failed: ${error.message}`);
  return code;
}

export async function resolveJoinCode(
  code: string,
): Promise<{ bundle_id: string; token: string } | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundle_join_codes")
    .select("bundle_id, token, expires_at")
    .eq("code", code.toLowerCase())
    .limit(1)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return { bundle_id: data.bundle_id, token: data.token };
}

export async function regenerateJoinCode(
  bundleId: string,
  token: string,
  expiryDays = 7,
): Promise<string> {
  const sb = getSupabase();
  await sb.from("bundle_join_codes").delete().eq("bundle_id", bundleId);
  return createJoinCode(bundleId, token, expiryDays);
}

export async function getJoinCode(bundleId: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("bundle_join_codes")
    .select("code, expires_at")
    .eq("bundle_id", bundleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.code;
}

export function isJoinCode(input: string): boolean {
  return (
    input.toLowerCase().startsWith(CODE_PREFIX) &&
    input.length === CODE_PREFIX.length + CODE_LENGTH
  );
}
