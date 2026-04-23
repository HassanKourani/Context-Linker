export interface ActiveSessionData {
  session_id: string;
  project_name: string;
  project_path: string;
  bundles: Array<{ bundle_id: string; mode: "local" | "cloud" }>;
  started_at: string;
  branch: string | null;
  entry_count?: number;
  cloud_session_id?: string | null;
  team_id?: string | null;
}

export interface CloudSessionData {
  id: string;
  team_id: string;
  project_name: string;
  project_path: string | null;
  machine_id: string;
  branch: string | null;
  started_at: string;
  last_active_at: string;
}

export interface GraphData {
  machine_id: string;
  teams: TeamGraphData[];
  local: { bundles: LocalBundleGraphData[] };
  sessions?: ActiveSessionData[];
}

export interface TeamGraphData {
  team_id: string;
  team_name: string;
  bundles: BundleGraphData[];
  cloud_sessions?: CloudSessionData[];
}

export interface BundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
}

export interface LocalBundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  projects: Array<{
    project_name: string;
    last_entry_at: string | null;
  }>;
}

// Entry types
export interface EntryRow {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
}

// Bundle types
export interface CreateBundleResult {
  bundle_id: string;
  name: string;
  join_token: string;
}

export interface JoinBundleResult {
  bundle_id: string;
  name: string;
}

// Rewind types
export interface RewindResult {
  applied: boolean;
  dry_run: boolean;
  affected_count: number;
  affected_entries: Array<{
    id: string;
    created_at: string;
    event_type: string;
    trigger_ref: string | null;
    summary_preview: string;
  }>;
  rewind_log_id?: string;
  message?: string;
}

export interface RestoreResult {
  restored_count: number;
  restored_ids: string[];
}

export interface RewindLogRow {
  id: string;
  bundle_id: string;
  project_name: string;
  strategy_kind: string;
  strategy_detail: unknown;
  affected_count: number;
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
}

// Team types
export interface TeamInfo {
  team_id: string;
  name: string;
  joined_at: string;
}

export interface CreateTeamResult {
  team_id: string;
  name: string;
}
