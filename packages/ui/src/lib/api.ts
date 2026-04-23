import type {
  GraphData,
  CreateBundleResult,
  JoinBundleResult,
  EntryRow,
  PushResult,
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
// Bundles
// ---------------------------------------------------------------------------

export function createBundle(body: { name: string; mode: "local" | "cloud"; team_id?: string }) {
  return apiPost<CreateBundleResult>("/api/bundles", body);
}

export function deleteBundle(bundleId: string, mode: "local" | "cloud") {
  return apiDelete<{ ok: true }>(`/api/bundles/${bundleId}?mode=${mode}`);
}

export function joinBundle(bundleId: string, body: { project_name: string; mode: "local" | "cloud"; session_id?: string }) {
  return apiPost<JoinBundleResult>(`/api/bundles/${bundleId}/join`, body);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function fetchSessionEntries(sessionId: string) {
  return apiGet<EntryRow[]>(`/api/sessions/${sessionId}/entries`);
}

export function connectSessionToBundle(sessionId: string, body: { bundle_id: string; mode: "local" | "cloud" }) {
  return apiPost<{ ok: true }>(`/api/sessions/${sessionId}/connect`, body);
}

export function unlinkSession(body: {
  session_id: string;
  bundle_id: string;
  project_name: string;
  mode: "local" | "cloud";
}) {
  return apiPost<{ ok: true }>("/api/unlink-session", body);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export function fetchEntries(
  bundleId: string,
  params: { mode?: string; limit?: number; since?: string; exclude_project?: string } = {},
) {
  const qs = new URLSearchParams();
  if (params.mode) qs.set("mode", params.mode);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.since) qs.set("since", params.since);
  if (params.exclude_project) qs.set("exclude_project", params.exclude_project);
  return apiGet<EntryRow[]>(`/api/bundles/${bundleId}/entries?${qs}`);
}

export function pushEntry(
  bundleId: string,
  body: {
    project_name: string;
    event_type: string;
    summary: string;
    files_touched?: string[];
    decisions?: Array<{ decision: string; rationale?: string; affects: string[] }>;
    mode?: string;
  },
) {
  return apiPost<PushResult>(`/api/bundles/${bundleId}/entries`, body);
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
