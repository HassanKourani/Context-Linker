/**
 * Local file-based storage backend for mode: "local".
 * Stores bundles and entry refs in ~/.ctx-link/local/<bundle_id>/
 * Entries live in session-entries files; bundles reference them via entry_refs.json.
 * No Supabase, no network, no tokens — just JSON files on disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { globalConfigDir, getSessionEntries } from "./config.js";
import type { SessionEntry } from "./config.js";
import { loadGlobalConfig } from "./config.js";
import type { PullInput, EntryRow } from "./entries.js";
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

function entryRefsPath(bundleId: string): string {
  return join(bundleDir(bundleId), "entry_refs.json");
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

interface LocalEntryRef {
  entry_id: string;
  session_id: string;
  added_at: string;
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

function readEntryRefs(bundleId: string): LocalEntryRef[] {
  const p = entryRefsPath(bundleId);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeEntryRefs(bundleId: string, refs: LocalEntryRef[]): void {
  writeFileSync(entryRefsPath(bundleId), JSON.stringify(refs, null, 2));
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

/** Update a session entry's superseded_at field in the session-entries file */
function setSessionEntrySuperseeded(sessionId: string, entryId: string, supersededAt: string | null): void {
  const entries = getSessionEntries(sessionId);
  const entry = entries.find(e => e.id === entryId);
  if (entry) {
    entry.superseded_at = supersededAt;
    const path = join(globalConfigDir(), "session-entries", `${sessionId}.json`);
    writeFileSync(path, JSON.stringify(entries, null, 2));
  }
}

/**
 * Resolve entry refs to actual EntryRow objects by loading from session-entries files.
 * Filters out superseded entries.
 */
function resolveEntryRefs(refs: LocalEntryRef[]): EntryRow[] {
  // Group refs by session
  const bySession = new Map<string, LocalEntryRef[]>();
  for (const ref of refs) {
    const arr = bySession.get(ref.session_id) ?? [];
    arr.push(ref);
    bySession.set(ref.session_id, arr);
  }

  const refEntryIds = new Set(refs.map(r => r.entry_id));
  const results: EntryRow[] = [];

  for (const [sessionId, sessionRefs] of bySession) {
    const entries = getSessionEntries(sessionId);
    const entryMap = new Map(entries.map(e => [e.id, e]));

    for (const ref of sessionRefs) {
      const e = entryMap.get(ref.entry_id);
      if (e && !e.superseded_at) {
        results.push({
          id: e.id,
          created_at: e.created_at,
          project_name: e.project_name,
          event_type: e.event_type,
          trigger_ref: e.trigger_ref,
          summary: e.summary,
          files_touched: e.files_touched ?? [],
          decisions: e.decisions ?? [],
        });
      }
    }
  }

  return results;
}

// ---------- Public API ----------

export function localCreateBundle(name: string): CreateBundleResult {
  const id = randomUUID();
  const dir = bundleDir(id);
  mkdirSync(dir, { recursive: true });

  const meta: LocalMeta = { id, name, created_at: new Date().toISOString() };
  writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
  writeFileSync(entriesPath(id), "[]");
  writeFileSync(entryRefsPath(id), "[]");

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
  const refs = readEntryRefs(bundleId);
  const resolved = resolveEntryRefs(refs);
  const sorted = resolved.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    bundle_id: meta.id,
    name: meta.name,
    session_count: 0,
    entry_count: resolved.length,
    last_entry_at: sorted[0]?.created_at ?? null,
  };
}

/**
 * Add entries to a local bundle by creating refs.
 * Skips entries that are already referenced.
 */
export function localAddEntriesToBundle(
  bundleId: string,
  entryIds: string[],
  sessionId: string
): { added: number; skipped: number } {
  if (entryIds.length === 0) return { added: 0, skipped: 0 };

  readMeta(bundleId); // validate bundle exists
  const refs = readEntryRefs(bundleId);
  const existingIds = new Set(refs.map(r => r.entry_id));

  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;

  for (const entryId of entryIds) {
    if (existingIds.has(entryId)) {
      skipped++;
    } else {
      refs.push({ entry_id: entryId, session_id: sessionId, added_at: now });
      added++;
    }
  }

  writeEntryRefs(bundleId, refs);
  return { added, skipped };
}

export function localPullEntries(input: PullInput): EntryRow[] {
  readMeta(input.bundle_id); // validate bundle exists
  const refs = readEntryRefs(input.bundle_id);
  let entries = resolveEntryRefs(refs);

  // Sort by created_at descending
  entries.sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (input.since) {
    entries = entries.filter((e) => e.created_at > input.since!);
  }

  if (input.exclude_project) {
    entries = entries.filter((e) => e.project_name !== input.exclude_project);
  }

  const limit = input.limit ?? 20;
  return entries.slice(0, limit);
}

/**
 * Remove a single entry ref from a local bundle.
 */
export function localRemoveEntryFromBundle(bundleId: string, entryId: string): void {
  const refs = readEntryRefs(bundleId);
  const filtered = refs.filter(r => r.entry_id !== entryId);
  writeEntryRefs(bundleId, filtered);
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

export function listAllLocalBundleDetails(): LocalBundleDetail[] {
  const dir = localDir();
  if (!existsSync(dir)) return [];

  const bundleIds = readdirSync(dir).filter((name) =>
    existsSync(join(dir, name, "meta.json"))
  );

  return bundleIds.map((id) => {
    const meta = readMeta(id);
    const refs = readEntryRefs(id);
    const entries = resolveEntryRefs(refs);
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

function findLocalCandidates(refs: LocalEntryRef[], input: RewindInput): Array<EntryRow & { _sessionId: string }> {
  const bySession = new Map<string, LocalEntryRef[]>();
  for (const ref of refs) {
    const arr = bySession.get(ref.session_id) ?? [];
    arr.push(ref);
    bySession.set(ref.session_id, arr);
  }

  // Resolve all refs to entries with session info
  const allEntries: Array<EntryRow & { _sessionId: string }> = [];
  for (const [sessionId, sessionRefs] of bySession) {
    const entries = getSessionEntries(sessionId);
    const entryMap = new Map(entries.map(e => [e.id, e]));
    for (const ref of sessionRefs) {
      const e = entryMap.get(ref.entry_id);
      if (e && !e.superseded_at) {
        allEntries.push({
          id: e.id,
          created_at: e.created_at,
          project_name: e.project_name,
          event_type: e.event_type,
          trigger_ref: e.trigger_ref,
          summary: e.summary,
          files_touched: e.files_touched ?? [],
          decisions: e.decisions ?? [],
          _sessionId: sessionId,
        });
      }
    }
  }

  let candidates = allEntries.sort((a, b) => b.created_at.localeCompare(a.created_at));

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
  const refs = readEntryRefs(input.bundle_id);
  const maxAffected = input.max_affected ?? 50;
  const candidates = findLocalCandidates(refs, input);

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

  // Soft-delete by setting superseded_at on session entries
  const now = new Date().toISOString();
  for (const candidate of candidates) {
    setSessionEntrySuperseeded(candidate._sessionId, candidate.id, now);
  }

  // Audit log
  const ids = candidates.map(c => c.id);
  const cfg = loadGlobalConfig();
  const logEntry: LocalRewindLog = {
    id: randomUUID(),
    bundle_id: input.bundle_id,
    project_name: input.project_name ?? "",
    strategy_kind: input.strategy.kind,
    strategy_detail: input.strategy,
    affected_entry_ids: ids,
    affected_count: ids.length,
    reason: input.reason ?? null,
    performed_by: cfg.machine_id,
    performed_at: now,
  };
  const log = readRewindLog(input.bundle_id);
  log.unshift(logEntry);
  writeRewindLog(input.bundle_id, log);

  return { applied: true, dry_run: false, affected_count: ids.length, affected_entries: affected, rewind_log_id: logEntry.id };
}

export function localRestoreRewound(input: RestoreInput): RestoreResult {
  readMeta(input.bundle_id);
  const refs = readEntryRefs(input.bundle_id);

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

  // Group refs by session and find superseded entries
  const bySession = new Map<string, LocalEntryRef[]>();
  for (const ref of refs) {
    const arr = bySession.get(ref.session_id) ?? [];
    arr.push(ref);
    bySession.set(ref.session_id, arr);
  }

  const restoredIds: string[] = [];

  for (const [sessionId, sessionRefs] of bySession) {
    const entries = getSessionEntries(sessionId);
    for (const ref of sessionRefs) {
      const e = entries.find(en => en.id === ref.entry_id);
      if (!e || !e.superseded_at) continue;

      // Apply project filter
      if (input.project_name && e.project_name !== input.project_name) continue;

      // Apply target filter
      if (targetIds && !targetIds.has(e.id)) continue;

      setSessionEntrySuperseeded(sessionId, e.id, null);
      restoredIds.push(e.id);
    }
  }

  return { restored_count: restoredIds.length, restored_ids: restoredIds };
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
