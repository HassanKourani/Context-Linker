import type { SessionEntry } from "./config.js";

/**
 * Consolidate a batch of session entries using heuristics:
 * - Per-file dedup: multiple edits to the same file → keep latest
 * - Commits stay separate (each git commit is its own entry)
 * - PR entries stay separate
 * - Different files stay separate
 *
 * Returns a new array (does not mutate input).
 */
export function consolidateEntries(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length <= 1) return entries;

  // Separate entries by type
  const commits: SessionEntry[] = [];
  const prs: SessionEntry[] = [];
  const edits: SessionEntry[] = [];
  const other: SessionEntry[] = [];

  for (const entry of entries) {
    if (entry.event_type === "commit") {
      commits.push(entry);
    } else if (entry.event_type === "pr_open") {
      prs.push(entry);
    } else if (entry.files_touched.length > 0) {
      edits.push(entry);
    } else {
      other.push(entry);
    }
  }

  // Deduplicate edits: keep the latest entry per file
  const latestByFile = new Map<string, SessionEntry>();
  // Sort edits oldest-first so later entries overwrite earlier ones
  const sortedEdits = [...edits].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const entry of sortedEdits) {
    for (const file of entry.files_touched) {
      latestByFile.set(file, entry);
    }
  }

  // Deduplicate: collect unique entries (by ID) from the file map
  const dedupedEdits = new Map<string, SessionEntry>();
  for (const entry of latestByFile.values()) {
    dedupedEdits.set(entry.id, entry);
  }

  // Combine all: commits + PRs + deduped edits + other, sorted by created_at
  const result = [...commits, ...prs, ...dedupedEdits.values(), ...other];
  result.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return result;
}
