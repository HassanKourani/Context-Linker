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
import { saveActiveSession, loadActiveSession, type ActiveSession } from "./config.js";
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
