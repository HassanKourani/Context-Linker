import { getSupabase } from "./supabase.js";
import { clearAuthFile } from "./auth-storage.js";

// Sign-in helpers and the in-memory User abstraction over Supabase Auth.
// The actual token persistence lives in auth-storage.ts (file-backed
// adapter passed to the supabase-js client).

export interface AuthUser {
  id: string;
  email: string | null;
}

export class NotAuthenticatedError extends Error {
  constructor(message = "Not signed in. Run `ctxl signin` first.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** Returns the signed-in user, or null if no valid session. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Throws NotAuthenticatedError if no valid session. */
export async function requireSession(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}

export interface SignInResult {
  user: AuthUser;
}

/** Sign in with email + password. Throws on failure. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  if (!data.user) throw new Error("Sign-in returned no user.");
  return { user: { id: data.user.id, email: data.user.email ?? null } };
}

/**
 * Create an account with email + password.
 * Depending on Supabase project settings, may require email confirmation
 * before the account is usable. Returns immediately either way.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<{ requires_email_confirmation: boolean; user: AuthUser | null }> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(`Sign-up failed: ${error.message}`);
  // Supabase returns user but no session when confirmation is required.
  const requires_email_confirmation = data.user !== null && data.session === null;
  return {
    requires_email_confirmation,
    user: data.user
      ? { id: data.user.id, email: data.user.email ?? null }
      : null,
  };
}

/**
 * Send a 6-digit OTP magic-link code to the user's email.
 * Auto-creates the user if they don't exist. The user verifies via
 * verifyEmailOtp().
 */
export async function sendEmailOtp(email: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(`Failed to send code: ${error.message}`);
}

/** Verify the 6-digit OTP code from the user's email and complete sign-in. */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<SignInResult> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw new Error(`Invalid or expired code: ${error.message}`);
  if (!data.user) throw new Error("Verification returned no user.");
  return { user: { id: data.user.id, email: data.user.email ?? null } };
}

/** Sign out and clear the local session file. */
export async function signOut(): Promise<void> {
  const sb = getSupabase();
  await sb.auth.signOut();
  // Defensive: ensure the file is gone even if the SDK didn't clear it.
  clearAuthFile();
}
