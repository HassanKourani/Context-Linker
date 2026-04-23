/**
 * Local file-based storage backend for mode: "local".
 * Stores bundles and entries in ~/.ctx-link/local/<bundle_id>/
 * No Supabase, no network, no tokens — just JSON files on disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { globalConfigDir } from "./config.js";
import type { SessionEntry } from "./config.js";
import { loadGlobalConfig } from "./config.js";
import type { PushInput, PushResult, PullInput, EntryRow } from "./entries.js";
import type { CreateBundleResult, JoinBundleResult, BundleStatus } from "./bundles.js";
import type { RewindInput, RewindResult, RewindCandidate, RestoreInput, RestoreResult, RewindLogRow } from "./rewind.js";

// ---------- Paths ----------

function localDir(): string {
  return join(globalConfigDir(), "local");
}

function bundleDir(bundleId: string): string {
  return join(localDir(), bundleId);
}

function metaPath(bundleId: string): string {
  return join(bundleDir(bundleId), "meta.json");
}

function entriesPath(bundleId: string): string {
  return join(bundleDir(bundleId), "entries.json");
}

function rewindLogPath(bundleId: string): string {
  return join(bundleDir(bundleId), "rewind_log.json");
}

/** Check if a bundle is stored locally */
export function isLocalBundle(bundleId: string): boolean {
  return existsSync(metaPath(bundleId));
}

// ---------- Internal helpers ----------

interface LocalMeta {
  id: string;
  name: string;
  created_at: string;
}

interface LocalEntry {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  raw_context: string | null;
  source_entries: SessionEntry[] | null;
  superseded_at: string | null;
}

interface LocalRewindLog {
  id: string;
  bundle_id: string;
  project_name: string;
  strategy_kind: string;
  strategy_detail: unknown;
  affected_entry_ids: string[];
  affected_count: number;
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
}

function readRewindLog(bundleId: string): LocalRewindLog[] {
  const p = rewindLogPath(bundleId);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeRewindLog(bundleId: string, log: LocalRewindLog[]): void {
  writeFileSync(rewindLogPath(bundleId), JSON.stringify(log, null, 2));
}

function readMeta(bundleId: string): LocalMeta {
  const p = metaPath(bundleId);
  if (!existsSync(p)) throw new Error(`Local bundle ${bundleId} not found.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function readEntries(bundleId: string): LocalEntry[] {
  const p = entriesPath(bundleId);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeEntries(bundleId: string, entries: LocalEntry[]): void {
  writeFileSync(entriesPath(bundleId), JSON.stringify(entries, null, 2));
}

// ---------- Public API (mirrors cloud functions) ----------

export function localCreateBundle(name: string): CreateBundleResult {
  const id = randomUUID();
  const dir = bundleDir(id);
  mkdirSync(dir, { recursive: true });

  const meta: LocalMeta = { id, name, created_at: new Date().toISOString() };
  writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
  writeFileSync(entriesPath(id), "[]");

  // No token needed for local bundles — return empty token
  return { bundle_id: id, name, join_token: `local_${id}` };
}

export function localJoinBundle(bundleId: string): JoinBundleResult {
  const meta = readMeta(bundleId);
  return { bundle_id: meta.id, name: meta.name };
}

export function localDeleteBundle(bundleId: string): void {
  const dir = bundleDir(bundleId);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
}

export function localBundleStatus(bundleId: string): BundleStatus {
  const meta = readMeta(bundleId);
  const entries = readEntries(bundleId).filter((e) => !e.superseded_at);
  const last = entries.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return {
    bundle_id: meta.id,
    name: meta.name,
    session_count: 0, // no sessions concept in local mode
    entry_count: entries.length,
    last_entry_at: last?.created_at ?? null,
  };
}

export function localPushEntry(input: PushInput): PushResult {
  const entries = readEntries(input.bundle_id);

  const entry: LocalEntry = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    project_name: input.project_name,
    event_type: input.event_type,
    trigger_ref: input.trigger_ref ?? null,
    summary: input.summary,
    files_touched: input.files_touched ?? [],
    decisions: input.decisions ?? [],
    raw_context: input.store_raw ? input.raw_context : null,
    source_entries: input.source_entries ?? null,
    superseded_at: null,
  };

  entries.push(entry);
  writeEntries(input.bundle_id, entries);

  return {
    entry_id: entry.id,
    summary: entry.summary,
    files_touched: entry.files_touched,
    decisions: entry.decisions,
  };
}

export function localPullEntries(input: PullInput): EntryRow[] {
  let entries = readEntries(input.bundle_id)
    .filter((e) => !e.superseded_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (input.since) {
    entries = entries.filter((e) => e.created_at > input.since!);
  }

  if (input.exclude_project) {
    entries = entries.filter((e) => e.project_name !== input.exclude_project);
  }

  const limit = input.limit ?? 20;
  return entries.slice(0, limit).map((e) => ({
    id: e.id,
    created_at: e.created_at,
    project_name: e.project_name,
    event_type: e.event_type,
    trigger_ref: e.trigger_ref,
    summary: e.summary,
    files_touched: e.files_touched,
    decisions: e.decisions,
    source_entries: e.source_entries ?? null,
  }));
}

export function localDeleteProjectFromBundle(bundleId: string, projectName: string): void {
  const entries = readEntries(bundleId);
  const filtered = entries.filter((e) => e.project_name !== projectName);
  writeEntries(bundleId, filtered);
}

export interface LocalBundleDetail {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  projects: Array<{
    project_name: string;
    last_entry_at: string | null;
  }>;
}

/** Remove a source entry from a consolidated bundle entry (local path). */
export function localRemoveSourceEntry(
  bundleId: string,
  entryId: string,
  sourceEntryId: string
): void {
  const entries = readEntries(bundleId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry || !entry.source_entries) return;

  entry.source_entries = entry.source_entries.filter((s) => s.id !== sourceEntryId);
  if (entry.source_entries.length === 0) entry.source_entries = null;
  writeEntries(bundleId, entries);
}

export function listAllLocalBundleDetails(): LocalBundleDetail[] {
  const dir = localDir();
  if (!existsSync(dir)) return [];

  const bundleIds = readdirSync(dir).filter((name) =>
    existsSync(join(dir, name, "meta.json"))
  );

  return bundleIds.map((id) => {
    const meta = readMeta(id);
    const entries = readEntries(id).filter((e) => !e.superseded_at);
    const sorted = entries.sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );

    const projectMap = new Map<string, string>();
    for (const entry of sorted) {
      if (!projectMap.has(entry.project_name)) {
        projectMap.set(entry.project_name, entry.created_at);
      }
    }

    return {
      bundle_id: meta.id,
      bundle_name: meta.name,
      entry_count: entries.length,
      last_entry_at: sorted[0]?.created_at ?? null,
      projects: Array.from(projectMap.entries()).map(([name, lastAt]) => ({
        project_name: name,
        last_entry_at: lastAt,
      })),
    };
  });
}

// ---------- Rewind / Restore ----------

function findLocalCandidates(entries: LocalEntry[], input: RewindInput): LocalEntry[] {
  let candidates = entries
    .filter((e) => !e.superseded_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (input.project_name) {
    candidates = candidates.filter((e) => e.project_name === input.project_name);
  }

  const strat = input.strategy;
  switch (strat.kind) {
    case "since":
      candidates = candidates.filter((e) => e.created_at >= strat.since);
      break;
    case "last_n":
      candidates = candidates.slice(0, strat.count);
      break;
    case "entry_ids": {
      if (strat.ids.length === 0) return [];
      const idSet = new Set(strat.ids);
      candidates = candidates.filter((e) => idSet.has(e.id));
      break;
    }
    case "after_ref": {
      const pivot = candidates.find((e) => e.trigger_ref === strat.trigger_ref);
      if (!pivot) return [];
      candidates = candidates.filter((e) => e.created_at > pivot.created_at);
      break;
    }
  }

  return candidates;
}

export function localRewindProject(input: RewindInput): RewindResult {
  readMeta(input.bundle_id); // validate bundle exists
  const entries = readEntries(input.bundle_id);
  const maxAffected = input.max_affected ?? 50;
  const candidates = findLocalCandidates(entries, input);

  const affected: RewindCandidate[] = candidates.map((e) => ({
    id: e.id,
    created_at: e.created_at,
    event_type: e.event_type,
    trigger_ref: e.trigger_ref,
    summary_preview: (e.summary ?? "").slice(0, 160),
  }));

  if (affected.length === 0) {
    return { applied: false, dry_run: !!input.dry_run, affected_count: 0, affected_entries: [], message: "No entries matched." };
  }

  if (affected.length > maxAffected && !input.force) {
    return {
      applied: false, dry_run: !!input.dry_run, affected_count: affected.length, affected_entries: affected,
      message: `Refusing to rewind ${affected.length} entries (max ${maxAffected}). Pass force=true to override.`,
    };
  }

  if (input.dry_run) {
    return { applied: false, dry_run: true, affected_count: affected.length, affected_entries: affected };
  }

  // Soft-delete
  const now = new Date().toISOString();
  const ids = new Set(affected.map((c) => c.id));
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      entry.superseded_at = now;
    }
  }
  writeEntries(input.bundle_id, entries);

  // Audit log
  const cfg = loadGlobalConfig();
  const logEntry: LocalRewindLog = {
    id: randomUUID(),
    bundle_id: input.bundle_id,
    project_name: input.project_name ?? "",
    strategy_kind: input.strategy.kind,
    strategy_detail: input.strategy,
    affected_entry_ids: Array.from(ids),
    affected_count: ids.size,
    reason: input.reason ?? null,
    performed_by: cfg.machine_id,
    performed_at: now,
  };
  const log = readRewindLog(input.bundle_id);
  log.unshift(logEntry);
  writeRewindLog(input.bundle_id, log);

  return { applied: true, dry_run: false, affected_count: ids.size, affected_entries: affected, rewind_log_id: logEntry.id };
}

export function localRestoreRewound(input: RestoreInput): RestoreResult {
  readMeta(input.bundle_id);
  const entries = readEntries(input.bundle_id);

  // Find entries eligible for restoration
  let targetIds: Set<string> | null = null;

  if (input.rewind_log_id) {
    const log = readRewindLog(input.bundle_id);
    const logEntry = log.find((l) => l.id === input.rewind_log_id);
    if (!logEntry) throw new Error("rewind_log_id not found.");
    if (logEntry.bundle_id !== input.bundle_id) throw new Error("rewind_log_id does not match bundle.");
    targetIds = new Set(logEntry.affected_entry_ids);
  } else if (input.entry_ids) {
    targetIds = new Set(input.entry_ids);
  }

  const superseded = entries.filter((e) => e.superseded_at !== null);
  const scoped = input.project_name
    ? superseded.filter((e) => e.project_name === input.project_name)
    : superseded;

  const toRestore = targetIds
    ? scoped.filter((e) => targetIds!.has(e.id))
    : scoped;

  if (toRestore.length === 0) {
    return { restored_count: 0, restored_ids: [] };
  }

  const restoreIds = new Set(toRestore.map((e) => e.id));
  for (const entry of entries) {
    if (restoreIds.has(entry.id)) {
      entry.superseded_at = null;
    }
  }
  writeEntries(input.bundle_id, entries);

  return { restored_count: restoreIds.size, restored_ids: Array.from(restoreIds) };
}

export function localListRewinds(bundleId: string, projectName?: string, limit = 20): RewindLogRow[] {
  readMeta(bundleId);
  let log = readRewindLog(bundleId);
  if (projectName) {
    log = log.filter((l) => l.project_name === projectName);
  }
  return log.slice(0, limit).map((l) => ({
    id: l.id,
    bundle_id: l.bundle_id,
    project_name: l.project_name,
    strategy_kind: l.strategy_kind,
    strategy_detail: l.strategy_detail,
    affected_count: l.affected_count,
    reason: l.reason,
    performed_by: l.performed_by,
    performed_at: l.performed_at,
  }));
}
