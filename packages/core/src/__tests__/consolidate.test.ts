import { describe, test, expect } from "bun:test";
import type { SessionEntry } from "../config.js";
import { consolidateEntries } from "../consolidate.js";

// ── Helper ───────────────────────────────────────────────────────────────────

let _seq = 0;

function makeEntry(
  overrides: Partial<SessionEntry> & { files_touched?: string[] } = {}
): SessionEntry {
  _seq++;
  // Pad seq so lexicographic sort matches chronological order
  const ts = `2024-01-01T00:${String(_seq).padStart(2, "0")}:00.000Z`;
  return {
    id: `entry-${_seq}`,
    created_at: ts,
    project_name: "test-project",
    event_type: "edit",
    trigger_ref: null,
    title: `entry ${_seq}`,
    summary: `entry ${_seq}`,
    files_touched: [],
    decisions: [],
    pushed_at: null,
    superseded_at: null,
    ...overrides,
  };
}

// Reset the sequence counter before each describe block is difficult with
// bun:test, so we just let it grow — IDs and timestamps remain unique.

// ── Tests ────────────────────────────────────────────────────────────────────

describe("consolidateEntries", () => {
  // 1. Empty array → returns empty array
  test("empty array returns empty array", () => {
    const result = consolidateEntries([]);
    expect(result).toEqual([]);
  });

  // 2. Single entry → returns same array reference (early-return, no copy)
  test("single entry returns the same array reference", () => {
    const entry = makeEntry({ files_touched: ["src/a.ts"] });
    const input = [entry];
    const result = consolidateEntries(input);
    // The spec early-returns `entries` for length <= 1, so we get the same array
    expect(result).toBe(input);
    // And it still contains the original entry
    expect(result[0]).toBe(entry);
  });

  // 3. Multiple edits to same file → keeps only the latest
  test("multiple edits to same file keeps only the latest", () => {
    const old1 = makeEntry({ files_touched: ["src/auth.ts"] });
    const old2 = makeEntry({ files_touched: ["src/auth.ts"] });
    const latest = makeEntry({ files_touched: ["src/auth.ts"] });

    const result = consolidateEntries([old1, old2, latest]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(latest.id);
  });

  // 4. Edits to different files → keeps all (as separate entries)
  test("edits to different files keeps all entries", () => {
    const a = makeEntry({ files_touched: ["src/a.ts"] });
    const b = makeEntry({ files_touched: ["src/b.ts"] });
    const c = makeEntry({ files_touched: ["src/c.ts"] });

    const result = consolidateEntries([a, b, c]);

    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(c.id);
  });

  // 5. Commits stay separate — never deduplicated, even with same files
  test("commit entries are never deduplicated", () => {
    const commit1 = makeEntry({
      event_type: "commit",
      files_touched: ["src/auth.ts"],
    });
    const commit2 = makeEntry({
      event_type: "commit",
      files_touched: ["src/auth.ts"],
    });
    const commit3 = makeEntry({
      event_type: "commit",
      files_touched: ["src/auth.ts"],
    });

    const result = consolidateEntries([commit1, commit2, commit3]);

    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(commit1.id);
    expect(ids).toContain(commit2.id);
    expect(ids).toContain(commit3.id);
  });

  // 6. PR entries stay separate — never deduplicated
  test("pr_open entries are never deduplicated", () => {
    const pr1 = makeEntry({ event_type: "pr_open", files_touched: ["src/auth.ts"] });
    const pr2 = makeEntry({ event_type: "pr_open", files_touched: ["src/auth.ts"] });

    const result = consolidateEntries([pr1, pr2]);

    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(pr1.id);
    expect(ids).toContain(pr2.id);
  });

  // 7. Mixed: 3 edits to auth.ts, 1 edit to routes.ts, 1 commit → 3 entries
  test("mixed scenario: 3 edits to auth.ts + 1 edit to routes.ts + 1 commit = 3 entries", () => {
    const authEdit1 = makeEntry({ files_touched: ["src/auth.ts"] });
    const authEdit2 = makeEntry({ files_touched: ["src/auth.ts"] });
    const authEdit3 = makeEntry({ files_touched: ["src/auth.ts"] });
    const routesEdit = makeEntry({ files_touched: ["src/routes.ts"] });
    const commit = makeEntry({
      event_type: "commit",
      files_touched: ["src/auth.ts", "src/routes.ts"],
    });

    const result = consolidateEntries([authEdit1, authEdit2, authEdit3, routesEdit, commit]);

    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.id);
    // Latest auth.ts edit should survive
    expect(ids).toContain(authEdit3.id);
    // routes.ts edit should survive
    expect(ids).toContain(routesEdit.id);
    // commit should survive
    expect(ids).toContain(commit.id);
    // Earlier auth edits should be gone
    expect(ids).not.toContain(authEdit1.id);
    expect(ids).not.toContain(authEdit2.id);
  });

  // 8. Result is sorted by created_at ascending
  test("result is sorted by created_at ascending", () => {
    // Create in reverse order to ensure we're actually sorting, not relying on input order
    const c = makeEntry({ files_touched: ["c.ts"] });
    const b = makeEntry({ files_touched: ["b.ts"] });
    const a = makeEntry({ files_touched: ["a.ts"] });
    // a is "newest" due to _seq but we want ascending order
    // Let's override created_at to control the order explicitly
    const e1 = { ...makeEntry({ files_touched: ["x.ts"] }), created_at: "2024-06-01T10:00:00.000Z" };
    const e2 = { ...makeEntry({ files_touched: ["y.ts"] }), created_at: "2024-06-01T12:00:00.000Z" };
    const e3 = { ...makeEntry({ files_touched: ["z.ts"] }), created_at: "2024-06-01T08:00:00.000Z" };

    const result = consolidateEntries([e2, e1, e3]);

    expect(result[0].id).toBe(e3.id);
    expect(result[1].id).toBe(e1.id);
    expect(result[2].id).toBe(e2.id);
    void a; void b; void c; // suppress unused var warnings
  });

  // 9. Does not mutate the input array
  test("does not mutate the input array", () => {
    const entries = [
      makeEntry({ files_touched: ["src/auth.ts"] }),
      makeEntry({ files_touched: ["src/auth.ts"] }),
      makeEntry({ files_touched: ["src/routes.ts"] }),
    ];
    const originalLength = entries.length;
    const originalIds = entries.map((e) => e.id);

    consolidateEntries(entries);

    expect(entries).toHaveLength(originalLength);
    expect(entries.map((e) => e.id)).toEqual(originalIds);
  });

  // 10. Entries with no files_touched go to "other" bucket — kept as-is
  test("entries with no files_touched are kept as-is in 'other' bucket", () => {
    const noFiles1 = makeEntry({ event_type: "edit", files_touched: [] });
    const noFiles2 = makeEntry({ event_type: "edit", files_touched: [] });
    const withFiles = makeEntry({ files_touched: ["src/a.ts"] });

    const result = consolidateEntries([noFiles1, noFiles2, withFiles]);

    // All three entries should be present (no-file entries are not deduped)
    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(noFiles1.id);
    expect(ids).toContain(noFiles2.id);
    expect(ids).toContain(withFiles.id);
  });

  // 11. Entry touching multiple files: if a later entry also touches one of
  //     those files, both entries survive (multi-file entry stays because it
  //     is the latest for its OTHER file).
  test("multi-file entry survives when a later entry claims only one of its files", () => {
    // Entry A touches both auth.ts and utils.ts
    const entryA = makeEntry({ files_touched: ["src/auth.ts", "src/utils.ts"] });
    // Entry B only touches auth.ts (later → wins for auth.ts)
    const entryB = makeEntry({ files_touched: ["src/auth.ts"] });

    const result = consolidateEntries([entryA, entryB]);

    // entryB is latest for auth.ts
    // entryA is latest for utils.ts → must still appear
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(entryA.id);
    expect(ids).toContain(entryB.id);
  });

  // Bonus: verify commits mixed with edits maintain correct separate count
  test("commits and edits for same file are both preserved", () => {
    const edit = makeEntry({ event_type: "edit", files_touched: ["src/main.ts"] });
    const commit = makeEntry({ event_type: "commit", files_touched: ["src/main.ts"] });

    const result = consolidateEntries([edit, commit]);

    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain(edit.id);
    expect(ids).toContain(commit.id);
  });
});
