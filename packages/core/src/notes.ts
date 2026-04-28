export const ROLES = [
  "ticket",
  "constraint",
  "design",
  "decision",
  "bug",
  "qa",
  "note",
] as const;

export type Role = typeof ROLES[number];

export const ROLE_PRIORITY: Record<Role, number> = {
  ticket: 1,
  constraint: 2,
  design: 3,
  decision: 4,
  bug: 5,
  qa: 6,
  note: 99,
};

export function rolePriority(role: Role | null | undefined): number {
  if (!role) return ROLE_PRIORITY.note;
  return ROLE_PRIORITY[role] ?? ROLE_PRIORITY.note;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

import { randomUUID } from "node:crypto";
import { saveActiveSession, loadActiveSession, pushSessionEntry, type ActiveSession } from "./config.js";
import {
  isLocalBundle,
  getLocalNotesSessionId,
  setLocalNotesSessionId,
} from "./local-store.js";
import {
  getCloudBundleNotesSessionId,
  setCloudBundleNotesSessionId,
  getBundleTeamId,
} from "./bundles.js";
import { createNotesCloudSession, getCloudSession } from "./cloud-sessions.js";
import { pushSessionToBundle } from "./session-actions.js";
import { getSupabase } from "./supabase.js";

/**
 * Lazily get-or-create the hidden per-bundle notes session.
 * Local bundles store the id on disk in meta.notes_session_id.
 * Cloud bundles store it in bundles.notes_session_id.
 * Re-creates if the stored id no longer points to an existing session.
 */
export async function getOrCreateNotesSession(bundleId: string): Promise<string> {
  if (isLocalBundle(bundleId)) {
    const stored = getLocalNotesSessionId(bundleId);
    if (stored && loadActiveSession(stored)) return stored;

    const sessionId = randomUUID();
    const session: ActiveSession = {
      session_id: sessionId,
      name: `notes:${bundleId.slice(0, 8)}`,
      project_name: "",
      project_path: "",
      bundles: [{ bundle_id: bundleId, mode: "local" }],
      started_at: new Date().toISOString(),
      branch: null,
      cloud_session_id: null,
      team_id: null,
      cloud_copies: [],
      kind: "notes",
    };
    saveActiveSession(session);
    setLocalNotesSessionId(bundleId, sessionId);
    return sessionId;
  }

  // cloud bundle
  const stored = await getCloudBundleNotesSessionId(bundleId);
  if (stored && (await getCloudSession(stored))) return stored;

  const teamId = await getBundleTeamId(bundleId);
  if (!teamId) throw new Error(`Cloud bundle ${bundleId} has no team — cannot create notes session.`);

  const newId = await createNotesCloudSession(teamId, bundleId);
  await setCloudBundleNotesSessionId(bundleId, newId);
  return newId;
}

export interface AddBundleNoteInput {
  bundle_id: string;
  summary: string;
  role?: Role;
  trigger_ref?: string | null;
  files_touched?: string[];
  decisions?: Array<{ decision: string; rationale?: string; affects: string[] }>;
}

export interface AddBundleNoteResult {
  bundle_id: string;
  notes_session_id: string;
  entry_id: string;
  role: Role;
}

/**
 * Add a role-tagged manual note to a bundle.
 * The entry is hosted in the bundle's hidden notes session (lazily created)
 * and referenced from the bundle. Local bundles store the entry on disk;
 * cloud bundles insert into cloud_session_entries directly.
 */
export async function addBundleNote(input: AddBundleNoteInput): Promise<AddBundleNoteResult> {
  const summary = input.summary?.trim();
  if (!summary) throw new Error("summary is required.");

  const role: Role = input.role ?? "note";
  if (!isRole(role)) throw new Error(`Unknown role: ${input.role}`);

  const bundleId = input.bundle_id;
  const notesSessionId = await getOrCreateNotesSession(bundleId);
  const isCloudHost = !isLocalBundle(bundleId);

  const triggerRef = input.trigger_ref ?? null;
  const filesTouched = input.files_touched ?? [];
  const decisions = input.decisions ?? [];

  let entryId: string;
  if (isCloudHost) {
    const sb = getSupabase();
    entryId = randomUUID();
    const { error } = await sb.from("cloud_session_entries").insert({
      id: entryId,
      session_id: notesSessionId,
      event_type: "manual",
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
      role,
    });
    if (error) throw new Error(`Failed to create note entry: ${error.message}`);
  } else {
    const entry = pushSessionEntry(notesSessionId, {
      project_name: "",
      event_type: "manual",
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
      role,
    });
    entryId = entry.id;
  }

  await pushSessionToBundle(notesSessionId, bundleId, [entryId]);

  return {
    bundle_id: bundleId,
    notes_session_id: notesSessionId,
    entry_id: entryId,
    role,
  };
}
