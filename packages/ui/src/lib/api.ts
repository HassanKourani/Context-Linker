import type {
  GraphData,
  CreateBundleResult,
  JoinBundleResult,
  EntryRow,
  CloudSessionData,
  RewindResult,
  RestoreResult,
  RewindLogRow,
  TeamInfo,
  CreateTeamResult,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `API error: ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `API error: ${res.status}`);
  }
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export async function fetchGraphData(): Promise<GraphData> {
  const res = await fetch("/api/graph");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Bundles — mode is resolved server-side from the bundle's storage
// ---------------------------------------------------------------------------

export function createBundle(body: { name: string; mode: "local" | "cloud"; team_id?: string }) {
  return apiPost<CreateBundleResult>("/api/bundles", body);
}

export function deleteBundle(bundleId: string) {
  return apiDelete<{ ok: true }>(`/api/bundles/${bundleId}`);
}

export function joinBundle(bundleId: string, body: { project_name: string }) {
  return apiPost<JoinBundleResult>(`/api/bundles/${bundleId}/join`, body);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function fetchSessionEntries(sessionId: string) {
  return apiGet<EntryRow[]>(`/api/sessions/${sessionId}/entries`);
}

export function deleteSessionApi(sessionId: string) {
  return apiDelete<{ ok: true }>(`/api/sessions/${sessionId}`);
}

export function connectSessionToBundle(sessionId: string, body: { bundle_id: string }) {
  return apiPost<{ ok: true }>(`/api/sessions/${sessionId}/connect`, body);
}

export function pushSessionToBundle(
  sessionId: string,
  body: { bundle_id: string; entry_ids?: string[] },
) {
  return apiPost<{ ok: true; pushed: number; skipped: number; total: number }>(
    `/api/sessions/${sessionId}/push-to-bundle`,
    body,
  );
}

export function deleteSessionEntryApi(sessionId: string, entryId: string) {
  return apiDelete<{ ok: true }>(`/api/sessions/${sessionId}/entries/${entryId}`);
}

export function unlinkSession(body: {
  session_id: string;
  bundle_id: string;
}) {
  return apiPost<{ ok: true }>("/api/unlink-session", body);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export function fetchEntries(
  bundleId: string,
  params: { limit?: number; since?: string; exclude_project?: string } = {},
) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.since) qs.set("since", params.since);
  if (params.exclude_project) qs.set("exclude_project", params.exclude_project);
  return apiGet<EntryRow[]>(`/api/bundles/${bundleId}/entries?${qs}`);
}

export function removeEntryRefFromBundle(bundleId: string, entryId: string) {
  return apiDelete<{ ok: true }>(`/api/bundles/${bundleId}/entries/${entryId}`);
}

// ---------------------------------------------------------------------------
// Rewind
// ---------------------------------------------------------------------------

export function rewindEntries(
  bundleId: string,
  body: {
    project_name: string;
    strategy: unknown;
    reason?: string;
    dry_run?: boolean;
    force?: boolean;
  },
) {
  return apiPost<RewindResult>(`/api/bundles/${bundleId}/rewind`, body);
}

export function restoreEntries(
  bundleId: string,
  body: { project_name: string; entry_ids?: string[]; rewind_log_id?: string },
) {
  return apiPost<RestoreResult>(`/api/bundles/${bundleId}/restore`, body);
}

export function fetchRewinds(
  bundleId: string,
  params: { project_name?: string; limit?: number } = {},
) {
  const qs = new URLSearchParams();
  if (params.project_name) qs.set("project_name", params.project_name);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiGet<RewindLogRow[]>(`/api/bundles/${bundleId}/rewinds?${qs}`);
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export function fetchTeams() {
  return apiGet<TeamInfo[]>("/api/teams");
}

export function createTeam(body: { name: string; password: string }) {
  return apiPost<CreateTeamResult>("/api/teams", body);
}

export function joinTeam(body: { name: string; password: string }) {
  return apiPost<CreateTeamResult>("/api/teams/join", body);
}

// ---------------------------------------------------------------------------
// Cloud Sessions
// ---------------------------------------------------------------------------

export function pushSessionToCloud(sessionId: string, body: { team_id: string }) {
  return apiPost<{ cloud_session_id: string; entries_synced: number }>(
    `/api/sessions/${sessionId}/push-to-cloud`,
    body,
  );
}

export function fetchTeamSessions(teamId: string) {
  return apiGet<CloudSessionData[]>(`/api/teams/${teamId}/sessions`);
}
