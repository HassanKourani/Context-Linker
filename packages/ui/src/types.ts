export interface GraphData {
  machine_id: string;
  teams: TeamGraphData[];
  local: { bundles: LocalBundleGraphData[] };
}

export interface TeamGraphData {
  team_id: string;
  team_name: string;
  bundles: BundleGraphData[];
}

export interface BundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  sessions: SessionGraphData[];
}

export interface SessionGraphData {
  session_id: string;
  project_name: string;
  machine_id: string;
  last_active_at: string | null;
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
