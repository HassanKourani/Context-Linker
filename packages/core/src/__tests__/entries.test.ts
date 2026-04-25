import { describe, test, expect } from "bun:test";
import { renderEntriesForClaude, type EntryRow } from "../entries.js";

// ── renderEntriesForClaude (pure function, no Supabase) ──────────────────────

describe("renderEntriesForClaude", () => {
  test("returns fallback message for empty array", () => {
    expect(renderEntriesForClaude([])).toBe("No recent cross-project context.");
  });

  test("renders single entry as markdown", () => {
    const entries: EntryRow[] = [
      {
        id: "e1",
        created_at: "2026-01-01T12:00:00Z",
        project_name: "backend",
        event_type: "commit",
        trigger_ref: "abc123",
        summary: "Added /api/auth endpoint",
        files_touched: ["src/auth.ts", "src/routes.ts"],
        decisions: [{ decision: "Use JWT", rationale: "Standard", affects: ["auth"] }],
      },
    ];
    const result = renderEntriesForClaude(entries);
    expect(result).toContain("backend");
    expect(result).toContain("Added /api/auth endpoint");
    expect(result).toContain("src/auth.ts");
  });

  test("renders multiple entries", () => {
    const entries: EntryRow[] = [
      {
        id: "e1",
        created_at: "2026-01-01T12:00:00Z",
        project_name: "backend",
        event_type: "commit",
        trigger_ref: null,
        summary: "First change",
        files_touched: [],
        decisions: [],
      },
      {
        id: "e2",
        created_at: "2026-01-02T12:00:00Z",
        project_name: "frontend",
        event_type: "manual",
        trigger_ref: null,
        summary: "Second change",
        files_touched: [],
        decisions: [],
      },
    ];
    const result = renderEntriesForClaude(entries);
    expect(result).toContain("First change");
    expect(result).toContain("Second change");
    expect(result).toContain("backend");
    expect(result).toContain("frontend");
  });

  test("handles entry with no files or decisions", () => {
    const entries: EntryRow[] = [
      {
        id: "e1",
        created_at: "2026-01-01T12:00:00Z",
        project_name: "proj",
        event_type: "manual",
        trigger_ref: null,
        summary: "Quick note",
        files_touched: [],
        decisions: [],
      },
    ];
    const result = renderEntriesForClaude(entries);
    expect(result).toContain("Quick note");
  });
});
