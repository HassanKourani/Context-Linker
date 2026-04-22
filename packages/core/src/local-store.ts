/**
 * Local file-based storage backend for mode: "local".
 * Stores bundles and entries in ~/.ctx-link/local/<bundle_id>/
 * No Supabase, no network, no tokens — just JSON files on disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { globalConfigDir } from "./config.js";
import type { PushInput, PushResult, PullInput, EntryRow } from "./entries.js";
import type { CreateBundleResult, JoinBundleResult, BundleStatus } from "./bundles.js";

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
  superseded_at: string | null;
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
  }));
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
