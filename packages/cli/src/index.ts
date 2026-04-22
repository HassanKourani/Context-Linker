#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { customAlphabet } from "nanoid";
import {
  saveGlobalConfig,
  globalConfigPath,
  loadProjectConfig,
  saveProjectConfig,
  createBundle,
  joinBundle,
  listLocalBundles,
  bundleStatus,
  pushEntry,
  pullEntries,
  renderEntriesForClaude,
  rewindProject,
  restoreRewound,
  listRewinds,
  type RewindStrategy,
} from "@ctx-link/core";

const program = new Command();
program.name("ctx-link").description("Connect Claude Code sessions across projects").version("0.1.0");

// ---------- init ----------
program
  .command("init")
  .description("Create global config with Supabase credentials")
  .requiredOption("--supabase-url <url>")
  .requiredOption("--supabase-key <key>", "service_role key")
  .option("--mode <mode>", "local | cloud", "local")
  .action((opts) => {
    const machineId = customAlphabet(
      "abcdefghijklmnopqrstuvwxyz0123456789",
      12
    )();
    saveGlobalConfig({
      mode: opts.mode,
      cloud_endpoint: null,
      supabase: { url: opts.supabaseUrl, service_role_key: opts.supabaseKey },
      machine_id: machineId,
    });
    console.log(`Wrote ${globalConfigPath()}`);
    console.log(`Machine ID: ${machineId}`);
  });

// ---------- create ----------
program
  .command("create <name>")
  .description("Create a new bundle in the current repo")
  .action(async (name: string) => {
    const r = await createBundle(name);
    const cfg = loadProjectConfig() ?? {
      project_name: detectProjectName(),
      bundles: [],
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    if (!cfg.bundles.includes(r.bundle_id)) cfg.bundles.push(r.bundle_id);
    saveProjectConfig(cfg);

    console.log("Bundle created.");
    console.log(`  ID:    ${r.bundle_id}`);
    console.log(`  Name:  ${r.name}`);
    console.log(`  Token: ${r.join_token}`);
    console.log("");
    console.log("Share the ID + token with another session via:");
    console.log(`  ctx-link join ${r.bundle_id} ${r.join_token}`);
  });

// ---------- join ----------
program
  .command("join <bundle_id> <token>")
  .description("Join an existing bundle from the current repo")
  .action(async (bundleId: string, token: string) => {
    const projectName = detectProjectName();
    const r = await joinBundle(bundleId, token, projectName);
    const cfg = loadProjectConfig() ?? {
      project_name: projectName,
      bundles: [],
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    if (!cfg.bundles.includes(r.bundle_id)) cfg.bundles.push(r.bundle_id);
    saveProjectConfig(cfg);
    console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}'.`);
  });

// ---------- list ----------
program
  .command("list")
  .description("List bundles this machine has joined")
  .action(() => {
    const bundles = listLocalBundles();
    if (bundles.length === 0) {
      console.log("No bundles joined on this machine.");
      return;
    }
    for (const b of bundles) {
      console.log(`${b.bundle_id}  ${b.name}  (joined ${b.joined_at})`);
    }
  });

// ---------- status ----------
program
  .command("status <bundle_id>")
  .description("Show status of a bundle")
  .action(async (bundleId: string) => {
    const s = await bundleStatus(bundleId);
    console.log(JSON.stringify(s, null, 2));
  });

// ---------- push ----------
program
  .command("push")
  .description("Push context from the current repo to its bundles")
  .option("--event <type>", "commit | pr_open | manual | session_end", "manual")
  .option("--ref <ref>", "commit sha / PR number / reference")
  .option("--diff", "capture git diff as raw_context (requires --summary)", false)
  .option("--message <text>", "summary text; also used as raw_context when --diff is not set")
  .option("--summary <text>", "explicit summary when using --diff")
  .action(async (opts) => {
    const cfg = loadProjectConfig();
    if (!cfg || cfg.bundles.length === 0) {
      console.error("No bundles configured for this project.");
      process.exit(1);
    }

    let raw: string;
    let summary: string;

    if (opts.diff) {
      if (!opts.summary) {
        console.error("--diff requires --summary (no AI in the CLI loop to generate one).");
        process.exit(1);
      }
      try {
        raw = execSync("git diff HEAD~1", { encoding: "utf8" });
      } catch {
        raw = execSync("git diff --cached", { encoding: "utf8" });
      }
      summary = opts.summary;
    } else {
      if (!opts.message) {
        console.error("Provide --message <text> or use --diff --summary <text>.");
        process.exit(1);
      }
      raw = opts.message;
      summary = opts.summary ?? opts.message;
    }

    for (const bundleId of cfg.bundles) {
      const r = await pushEntry({
        bundle_id: bundleId,
        project_name: cfg.project_name,
        event_type: opts.event,
        trigger_ref: opts.ref ?? null,
        raw_context: raw,
        summary,
      });
      console.log(`[${bundleId}] pushed entry ${r.entry_id}`);
      console.log(`  ${r.summary}`);
    }
  });

// ---------- pull ----------
program
  .command("pull [bundle_id]")
  .description("Pull recent entries. If no bundle_id, pulls from all project bundles.")
  .option("--since <iso>")
  .option("--limit <n>", "default 20", "20")
  .option("--include-self", "don't filter out own project", false)
  .action(async (bundleId: string | undefined, opts) => {
    const cfg = loadProjectConfig();
    const bundleIds = bundleId
      ? [bundleId]
      : cfg?.bundles ?? [];

    if (bundleIds.length === 0) {
      console.error("No bundle specified and none configured.");
      process.exit(1);
    }

    for (const bid of bundleIds) {
      const rows = await pullEntries({
        bundle_id: bid,
        since: opts.since,
        limit: Number(opts.limit),
        exclude_project: opts.includeSelf ? undefined : cfg?.project_name,
      });
      console.log(`=== ${bid} (${rows.length} entries) ===`);
      console.log(renderEntriesForClaude(rows));
      console.log("");
    }
  });

// ---------- rewind ----------
program
  .command("rewind")
  .description("Soft-delete entries from ONE project in a bundle (other projects untouched)")
  .requiredOption("--bundle <id>")
  .requiredOption("--project <name>")
  .option("--since <iso>", "rewind entries created at or after this timestamp")
  .option("--last-n <n>", "rewind the last N entries from this project")
  .option("--entry-ids <ids>", "comma-separated entry IDs to rewind")
  .option("--after-ref <ref>", "rewind everything AFTER this trigger_ref (pivot kept)")
  .option("--reason <msg>", "why you're rewinding (stored in audit log)")
  .option("--apply", "actually perform the rewind (default is dry-run)", false)
  .option("--force", "override the max-affected safety cap", false)
  .option("--max <n>", "max affected entries without --force", "50")
  .action(async (opts) => {
    // Exactly one strategy required.
    const provided = [opts.since, opts.lastN, opts.entryIds, opts.afterRef].filter(Boolean);
    if (provided.length !== 1) {
      console.error("Specify exactly one of: --since, --last-n, --entry-ids, --after-ref");
      process.exit(1);
    }

    let strategy: RewindStrategy;
    if (opts.since) strategy = { kind: "since", since: opts.since };
    else if (opts.lastN) strategy = { kind: "last_n", count: Number(opts.lastN) };
    else if (opts.entryIds)
      strategy = { kind: "entry_ids", ids: opts.entryIds.split(",").map((s: string) => s.trim()) };
    else strategy = { kind: "after_ref", trigger_ref: opts.afterRef };

    const dryRun = !opts.apply;
    const r = await rewindProject({
      bundle_id: opts.bundle,
      project_name: opts.project,
      strategy,
      reason: opts.reason,
      dry_run: dryRun,
      max_affected: Number(opts.max),
      force: opts.force,
    });

    console.log(
      `${dryRun ? "[DRY RUN] Would rewind" : "Rewound"} ${r.affected_count} entries from ${opts.project}`
    );
    if (r.message) console.log(r.message);
    for (const e of r.affected_entries) {
      console.log(
        `  - ${e.id}  [${e.created_at}]  ${e.event_type}${e.trigger_ref ? ` (${e.trigger_ref})` : ""}`
      );
      console.log(`    ${e.summary_preview}`);
    }
    if (dryRun && r.affected_count > 0) {
      console.log("\nRe-run with --apply to perform the rewind.");
    }
    if (r.rewind_log_id) {
      console.log(`\nAudit log: ${r.rewind_log_id}`);
      console.log(`Undo with: ctx-link restore --bundle ${opts.bundle} --project ${opts.project} --from-log ${r.rewind_log_id}`);
    }
  });

// ---------- restore ----------
program
  .command("restore")
  .description("Undo a rewind")
  .requiredOption("--bundle <id>")
  .requiredOption("--project <name>")
  .option("--entry-ids <ids>", "comma-separated entry IDs to restore")
  .option("--from-log <id>", "restore all entries from a specific rewind_log_id")
  .action(async (opts) => {
    const r = await restoreRewound({
      bundle_id: opts.bundle,
      project_name: opts.project,
      entry_ids: opts.entryIds ? opts.entryIds.split(",").map((s: string) => s.trim()) : undefined,
      rewind_log_id: opts.fromLog,
    });
    console.log(`Restored ${r.restored_count} entries.`);
    for (const id of r.restored_ids) console.log(`  - ${id}`);
  });

// ---------- rewind-history ----------
program
  .command("rewind-history <bundle_id>")
  .description("Show past rewinds for a bundle")
  .option("--project <name>")
  .option("--limit <n>", "default 20", "20")
  .action(async (bundleId: string, opts) => {
    const rows = await listRewinds(bundleId, opts.project, Number(opts.limit));
    if (rows.length === 0) {
      console.log("No rewinds recorded.");
      return;
    }
    for (const r of rows) {
      console.log(
        `${r.performed_at}  ${r.project_name}  ${r.strategy_kind}  ${r.affected_count} entries`
      );
      if (r.reason) console.log(`  reason: ${r.reason}`);
      console.log(`  log_id: ${r.id}`);
    }
  });

// ---------- helpers ----------
function detectProjectName(): string {
  const pkgPath = `${process.cwd()}/package.json`;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  return process.cwd().split("/").pop() ?? "unknown";
}

program.parseAsync().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
