import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

import {
  loadGlobalConfig,
  listActiveSessions,
  listMyTeams,
  listAllLocalBundleDetails,
  listTeamBundles,
  bundleStatus,
  createBundle,
  deleteBundle,
  joinBundle,
  getBundleToken,
  isLocalBundle,
  pullEntries,
  addEntriesToBundle,
  removeSessionEntriesFromBundle,
  includeEntryInBundle,
  localAddEntriesToBundle,
  localRemoveSessionRefsFromBundle,
  localIncludeEntryInBundle,
  localRemoveEntryRefsFromBundleByIds,
  createTeam,
  joinTeam,
  getSessionEntries,
  pushSessionEntry,
  connectSessionToBundle,
  disconnectSessionFromBundle,
  deleteActiveSession,
  loadActiveSession,
  copySessionToCloud,
  listTeamSessions,
  deleteCloudSession,
  getCloudSessionEntries,
  getCloudSession,
  getBundleTeamId,
  connectCloudSessionToBundle,
  disconnectCloudSessionFromBundle,
  getCloudSessionBundleConnections,
  syncSessionToCloud,
  saveActiveSession,
  renameCloudSession,
  listBundleQuestions,
  askQuestion,
  answerQuestion,
  resolveQuestion,
  countOpenQuestions,
  getQuestion,
  getSupabase,
  unlinkSessionFromBundle,
  deleteSession,
  pushSessionToBundle,
  pushBundleToCloud,
  pullEntriesFromConnectedSessions,
  renameSessionAndCloudCopies,
  deleteSessionEntryAndCopies,
  bundleRewind,
  bundleRestore,
  bundleListRewinds,
  bundleRemoveEntryRef,
  readFeedEvents,
} from "@ctx-link/core";

// Broadcast Q&A events to active MCP sessions via their channel ports
async function broadcastQuestion(bundleId: string, question: any, fromSessionId: string, fromProject: string) {
  const sessions = listActiveSessions();
  const targets = sessions.filter(
    (s) => s.session_id !== fromSessionId && s.channel_port && s.bundles.some((b) => b.bundle_id === bundleId),
  );
  for (const s of targets) {
    try {
      await fetch(`http://127.0.0.1:${s.channel_port}/channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "question_asked",
          bundle_id: bundleId,
          question,
          from_session_id: fromSessionId,
          from_project: fromProject,
          target_project: question.target_project,
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {}
  }
}

async function broadcastAnswer(bundleId: string, question: any, fromSessionId: string, fromProject: string) {
  const sessions = listActiveSessions();
  const targets = sessions.filter(
    (s) => s.session_id !== fromSessionId && s.channel_port && s.bundles.some((b) => b.bundle_id === bundleId),
  );
  for (const s of targets) {
    try {
      await fetch(`http://127.0.0.1:${s.channel_port}/channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "question_answered",
          bundle_id: bundleId,
          question,
          from_session_id: fromSessionId,
          from_project: fromProject,
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {}
  }
}

const CTX_LINK_PORT = parseInt(process.env.CTX_LINK_PORT || "5174", 10);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: CTX_LINK_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const origin = req.headers.get("Origin") ?? "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    /** Resolve bundle mode from storage — local dir exists → "local", else "cloud" */
    function resolveBundleMode(bundleId: string): "local" | "cloud" {
      return isLocalBundle(bundleId) ? "local" : "cloud";
    }

    // ── GET /api/graph ────────────────────────────────────────────────────────
    if (url.pathname === "/api/graph" && req.method === "GET") {
      try {
        const config = loadGlobalConfig();
        const teams = listMyTeams();
        const sb = getSupabase();

        // Fetch bundles + sessions for ALL teams in parallel (2 queries per team)
        const teamRawData = await Promise.all(
          teams.map(async (team) => {
            const [{ data: bundleRows }, cloudSessions] = await Promise.all([
              sb.from("bundles")
                .select("id, name, created_at")
                .eq("team_id", team.team_id)
                .order("created_at", { ascending: false }),
              listTeamSessions(team.team_id),
            ]);
            return { team, bundles: bundleRows ?? [], cloudSessions };
          })
        );

        // Collect ALL bundle IDs and session IDs across teams for batch queries
        const allBundleIds = teamRawData.flatMap((t) => t.bundles.map((b) => b.id));
        const allSessionIds = teamRawData.flatMap((t) => t.cloudSessions.map((s) => s.id));

        // Batch: get ALL entry refs + ALL session entry counts in 2 queries total
        const [entryRefsResult, sessionEntriesResult] = await Promise.all([
          allBundleIds.length > 0
            ? sb.from("bundle_entry_refs")
                .select("bundle_id, cloud_session_entries(created_at)")
                .in("bundle_id", allBundleIds)
            : Promise.resolve({ data: [] as any[] }),
          allSessionIds.length > 0
            ? sb.from("cloud_session_entries")
                .select("session_id")
                .in("session_id", allSessionIds)
                .is("superseded_at", null)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        // Index bundle entry refs: { bundle_id → { count, last_entry_at } }
        const bundleStats = new Map<string, { count: number; last_entry_at: string | null }>();
        for (const ref of (entryRefsResult.data ?? [])) {
          const stats = bundleStats.get(ref.bundle_id) ?? { count: 0, last_entry_at: null };
          stats.count++;
          const createdAt = (ref as any).cloud_session_entries?.created_at;
          if (createdAt && (!stats.last_entry_at || new Date(createdAt) > new Date(stats.last_entry_at))) {
            stats.last_entry_at = createdAt;
          }
          bundleStats.set(ref.bundle_id, stats);
        }

        // Index session entry counts: { session_id → count }
        const sessionEntryCounts = new Map<string, number>();
        for (const entry of (sessionEntriesResult.data ?? [])) {
          sessionEntryCounts.set(entry.session_id, (sessionEntryCounts.get(entry.session_id) ?? 0) + 1);
        }

        // Assemble team data (no more Supabase calls — all local lookups)
        const teamData = teamRawData.map(({ team, bundles, cloudSessions }) => ({
          team_id: team.team_id,
          team_name: team.name,
          bundles: bundles.map((b) => {
            const stats = bundleStats.get(b.id);
            return {
              bundle_id: b.id,
              bundle_name: b.name,
              entry_count: stats?.count ?? 0,
              last_entry_at: stats?.last_entry_at ?? null,
            };
          }),
          cloud_sessions: cloudSessions.map((cs) => ({
            ...cs,
            entry_count: sessionEntryCounts.get(cs.id) ?? 0,
            bundles: getCloudSessionBundleConnections(cs.id),
          })),
        }));

        const localBundles = listAllLocalBundleDetails();
        const sessions = listActiveSessions().map((s) => ({
          ...s,
          entry_count: getSessionEntries(s.session_id).length,
        }));

        return Response.json(
          {
            machine_id: config.machine_id,
            teams: teamData,
            local: { bundles: localBundles },
            sessions,
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/teams ────────────────────────────────────────────────────────
    if (url.pathname === "/api/teams" && req.method === "GET") {
      try {
        const teams = listMyTeams();
        return Response.json(teams, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── POST /api/teams ───────────────────────────────────────────────────────
    if (url.pathname === "/api/teams" && req.method === "POST") {
      try {
        const { name, password } = await req.json();
        const result = await createTeam(name, password);
        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── POST /api/teams/join ──────────────────────────────────────────────────
    if (url.pathname === "/api/teams/join" && req.method === "POST") {
      try {
        const { name, password } = await req.json();
        const result = await joinTeam(name, password);
        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/teams/:id/feed ───────────────────────────────────────────────
    {
      const feedMatch = url.pathname.match(/^\/api\/teams\/([^/]+)\/feed$/);
      if (feedMatch && req.method === "GET") {
        try {
          const teamId = feedMatch[1];
          const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
          const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
          const events = await readFeedEvents(teamId, { limit, offset });
          return Response.json(events, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
        }
      }
    }

    // ── GET /api/teams/:id/sessions ───────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/teams\/([^/]+)\/sessions$/);
      if (match && req.method === "GET") {
        try {
          const teamId = match[1];
          const sessions = await listTeamSessions(teamId);
          return Response.json(sessions, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles ─────────────────────────────────────────────────────
    if (url.pathname === "/api/bundles" && req.method === "POST") {
      try {
        const { name, mode, team_id } = await req.json();
        const result = await createBundle(name, mode, team_id);
        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── DELETE /api/bundles/:id ───────────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        try {
          const bundleId = match[1];
          const mode = resolveBundleMode(bundleId);

          // Disconnect all sessions from this bundle first
          const activeSessions = listActiveSessions();
          for (const s of activeSessions) {
            if (s.bundles.some((b) => b.bundle_id === bundleId)) {
              disconnectSessionFromBundle(s.session_id, bundleId);
            }
          }

          // Also clean up cloud session bundle connections
          const teams = listMyTeams();
          for (const team of teams) {
            const cloudSessions = await listTeamSessions(team.team_id);
            for (const cs of cloudSessions) {
              disconnectCloudSessionFromBundle(cs.id, bundleId);
            }
          }

          await deleteBundle(bundleId, mode);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/join ────────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/join$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { project_name } = await req.json();
          const mode = resolveBundleMode(bundleId);
          const token = getBundleToken(bundleId) || "";
          const result = await joinBundle(bundleId, token, project_name, mode);
          return Response.json(result, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── DELETE /api/bundles/:bundleId/entries/:entryId ────────────────────────
    // MUST be matched before GET/POST /api/bundles/:id/entries (two path params)
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/entries\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        try {
          const bundleId = match[1];
          const entryId = match[2];
          await bundleRemoveEntryRef(bundleId, entryId, { exclude: true });
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/include-entry — re-include a previously excluded entry
    {
      const includeMatch = url.pathname.match(/^\/api\/bundles\/([^/]+)\/include-entry$/);
      if (includeMatch && req.method === "POST") {
        try {
          const bundleId = includeMatch[1];
          const { entry_id } = await req.json() as { entry_id: string };
          if (isLocalBundle(bundleId)) {
            localIncludeEntryInBundle(bundleId, entry_id);
          } else {
            await includeEntryInBundle(bundleId, entry_id);
          }
          return Response.json({ included: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
        }
      }
    }

    // ── GET /api/bundles/:id/entries ──────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/entries$/);
      if (match && req.method === "GET") {
        try {
          const bundleId = match[1];
          const since = url.searchParams.get("since") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const exclude_project = url.searchParams.get("exclude_project") || undefined;
          const mode = resolveBundleMode(bundleId);
          const entries = await pullEntries({
            bundle_id: bundleId,
            since,
            limit,
            exclude_project,
            mode,
            skipAuth: true,
          });
          return Response.json(entries, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/rewind ──────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/rewind$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { project_name, strategy, reason, dry_run, force } = await req.json();
          const result = await bundleRewind({
            bundle_id: bundleId,
            project_name,
            strategy,
            reason,
            dry_run,
            force,
          });
          return Response.json(result, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/restore ─────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/restore$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { project_name, entry_ids, rewind_log_id } = await req.json();
          const result = await bundleRestore({
            bundle_id: bundleId,
            project_name,
            entry_ids,
            rewind_log_id,
          });
          return Response.json(result, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── GET /api/bundles/:id/rewinds ──────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/rewinds$/);
      if (match && req.method === "GET") {
        try {
          const bundleId = match[1];
          const project_name = url.searchParams.get("project_name") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "20");
          const rewinds = await bundleListRewinds(bundleId, project_name, limit);
          return Response.json(rewinds, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/pull-from-sessions ─────────────────────────────
    // Pulls entries from ALL sessions connected to this bundle in one shot.
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/pull-from-sessions$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { pushed, skipped } = await pullEntriesFromConnectedSessions(bundleId);
          return Response.json(
            { ok: true, pushed, skipped },
            { headers: corsHeaders }
          );
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/push-to-cloud ─────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/push-to-cloud$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { team_id } = await req.json();
          if (!team_id) {
            return Response.json(
              { error: "team_id is required." },
              { status: 400, headers: corsHeaders }
            );
          }
          const result = await pushBundleToCloud(bundleId, team_id);
          return Response.json(
            { ok: true, ...result },
            { headers: corsHeaders }
          );
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── GET /api/sessions/:id/entries ────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/entries$/);
      if (match && req.method === "GET") {
        try {
          const sessionId = match[1];
          // Try local session entries first
          let entries: any[] = getSessionEntries(sessionId);
          // If empty, try cloud session entries (sessionId might be a cloud session ID)
          if (entries.length === 0) {
            try {
              const cloudEntries = await getCloudSessionEntries(sessionId);
              // Get project name from the cloud session
              const cs = await getCloudSession(sessionId);
              const projectName = cs?.project_name ?? "unknown";
              entries = cloudEntries.map((e) => ({
                id: e.id,
                created_at: e.created_at,
                project_name: projectName,
                event_type: e.event_type,
                trigger_ref: e.trigger_ref,
                summary: e.summary,
                files_touched: e.files_touched ?? [],
                decisions: e.decisions ?? [],
              }));
            } catch { /* not a cloud session */ }
          }
          return Response.json(entries, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/sessions/:id/entries ───────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/entries$/);
      if (match && req.method === "POST") {
        try {
          const sessionId = match[1];
          const { project_name, event_type, summary, trigger_ref, files_touched, decisions } = await req.json();
          const entry = pushSessionEntry(sessionId, {
            project_name,
            event_type,
            trigger_ref: trigger_ref ?? null,
            summary,
            files_touched: files_touched ?? [],
            decisions: decisions ?? [],
          });
          return Response.json(entry, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/sessions/:id/push-to-bundle ─────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/push-to-bundle$/);
      if (match && req.method === "POST") {
        try {
          const sessionId = match[1];
          const { bundle_id, entry_ids } = await req.json();
          const result = await pushSessionToBundle(sessionId, bundle_id, entry_ids);
          return Response.json(
            { ok: true, ...result },
            { headers: corsHeaders }
          );
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/sessions/:id/copy-to-cloud ─────────────────────────────
    // Creates an independent copy of the session in the cloud.
    // Optionally connects the cloud copy to a bundle and adds its entries.
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/copy-to-cloud$/);
      if (match && req.method === "POST") {
        try {
          const sessionId = match[1];
          const { team_id, bundle_id } = await req.json();
          if (!team_id) {
            return Response.json(
              { error: "team_id is required" },
              { status: 400, headers: corsHeaders }
            );
          }

          // Prevent copying the same session twice into the same team
          const activeSession = loadActiveSession(sessionId);
          const copies = activeSession?.cloud_copies ?? [];
          if (copies.some((c) => c.team_id === team_id)) {
            return Response.json(
              { error: "This session has already been copied to this team." },
              { status: 409, headers: corsHeaders }
            );
          }

          const result = await copySessionToCloud(sessionId, team_id);

          // Track cloud copy so sync works for all copies
          if (activeSession) {
            if (!activeSession.cloud_copies) activeSession.cloud_copies = [];
            activeSession.cloud_copies.push({ cloud_session_id: result.cloud_session_id, team_id });
            // Keep legacy fields pointing to first copy
            if (!activeSession.cloud_session_id) {
              activeSession.cloud_session_id = result.cloud_session_id;
              activeSession.team_id = team_id;
            }
            saveActiveSession(activeSession);
          }

          // If a bundle_id was provided, connect the cloud session and add entries
          if (bundle_id) {
            const bundleTeamId = await getBundleTeamId(bundle_id);
            if (bundleTeamId !== team_id) {
              return Response.json(
                { error: "Bundle and session must be in the same team." },
                { status: 400, headers: corsHeaders }
              );
            }
            // Connect the new cloud session to the bundle
            connectCloudSessionToBundle(result.cloud_session_id, bundle_id, "cloud");
            if (result.cloud_entry_ids.length > 0) {
              await addEntriesToBundle(bundle_id, result.cloud_entry_ids);
            }
          }

          return Response.json(result, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/sessions/:id/sync-to-cloud ────────────────────────────────
    // Called with a cloud session ID. Finds the linked local session and syncs new entries.
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/sync-to-cloud$/);
      if (match && req.method === "POST") {
        try {
          const cloudSessionId = match[1];

          // Find the local active session linked to this cloud session
          const allSessions = listActiveSessions();
          const localSession = allSessions.find((s) =>
            s.cloud_session_id === cloudSessionId ||
            (s.cloud_copies ?? []).some((c) => c.cloud_session_id === cloudSessionId)
          );
          if (!localSession) {
            return Response.json(
              { error: "No local session linked to this cloud session" },
              { status: 404, headers: corsHeaders }
            );
          }

          const result = await syncSessionToCloud(localSession.session_id, cloudSessionId);

          // Also add new entries to any connected bundles
          if (result.cloud_entry_ids.length > 0) {
            const connections = getCloudSessionBundleConnections(cloudSessionId);
            for (const conn of connections) {
              try {
                await addEntriesToBundle(conn.bundle_id, result.cloud_entry_ids);
              } catch {}
            }
            // Also check local session bundle connections (cloud bundles)
            for (const b of localSession.bundles) {
              if (b.mode === "cloud") {
                try {
                  await addEntriesToBundle(b.bundle_id, result.cloud_entry_ids);
                } catch {}
              }
            }
          }

          return Response.json(result, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/sessions/:id/connect ──────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/connect$/);
      if (match && req.method === "POST") {
        try {
          const sessionId = match[1];
          const { bundle_id } = await req.json();
          const mode = resolveBundleMode(bundle_id);

          // Check if this is a local active session or a cloud session
          const localSession = loadActiveSession(sessionId);

          if (localSession) {
            // Local session → any bundle: just record the connection locally.
            // For cloud bundles this enables pull. Entries stay local until
            // explicitly pushed to cloud via "Copy to Cloud".
            const session = connectSessionToBundle(sessionId, bundle_id, mode);
            return Response.json({ ok: true, session }, { headers: corsHeaders });
          }

          // Cloud session — just record the connection, same as local sessions.
          // Entries are pushed separately via push-to-bundle.
          connectCloudSessionToBundle(sessionId, bundle_id, mode);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── PATCH /api/sessions/:id/rename ─────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rename$/);
      if (match && req.method === "PATCH") {
        try {
          const sessionId = match[1];
          const { name } = await req.json();
          const trimmed = typeof name === "string" && name.trim() ? name.trim() : null;

          if (loadActiveSession(sessionId)) {
            await renameSessionAndCloudCopies(sessionId, trimmed);
          } else {
            // sessionId is a cloud-only session (no local active record)
            await renameCloudSession(sessionId, trimmed);
          }

          return Response.json({ ok: true, name: trimmed }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── DELETE /api/sessions/:id/entries/:entryId ───────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/entries\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        try {
          const sessionId = match[1];
          const entryId = match[2];
          await deleteSessionEntryAndCopies(sessionId, entryId);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── DELETE /api/sessions/:id ────────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        try {
          await deleteSession(match[1]);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/unlink-session ────────────────────────────────────────────
    if (url.pathname === "/api/unlink-session" && req.method === "POST") {
      try {
        const { session_id, bundle_id } = await req.json();
        await unlinkSessionFromBundle(session_id, bundle_id);
        return Response.json({ ok: true }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/sessions ──────────────────────────────────────────────────
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      try {
        // Return active sessions (with bundle connections) from ~/.ctx-link/active-sessions/
        const activeSessions = listActiveSessions();
        return Response.json(activeSessions, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET /api/bundles/:id/questions ──────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/questions$/);
      if (match && req.method === "GET") {
        try {
          const bundleId = match[1];
          const status = url.searchParams.get("status") as "open" | "answered" | "resolved" | undefined;
          const targetProject = url.searchParams.get("target_project") || undefined;
          const questions = listBundleQuestions(bundleId, { status: status || undefined, targetProject });
          return Response.json(questions, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/questions ─────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/questions$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { question, target_project, context, session_id, project_name } = await req.json();
          const q = askQuestion(bundleId, session_id, project_name, question, {
            targetProject: target_project,
            context,
          });
          // Notify active MCP sessions about the new question
          broadcastQuestion(bundleId, q, session_id, project_name).catch(() => {});
          return Response.json(q, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/questions/:qid/answer ─────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/questions\/([^/]+)\/answer$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const questionId = match[2];
          const { answer, session_id, project_name } = await req.json();
          const a = answerQuestion(bundleId, questionId, session_id, project_name, answer);
          // Notify active MCP sessions about the answer
          const answeredQ = listBundleQuestions(bundleId).find((q) => q.id === questionId);
          if (answeredQ) broadcastAnswer(bundleId, answeredQ, session_id, project_name).catch(() => {});
          return Response.json(a, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── POST /api/bundles/:id/questions/:qid/resolve ────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/questions\/([^/]+)\/resolve$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const questionId = match[2];
          resolveQuestion(bundleId, questionId);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }

    // ── Static file serving (built UI from dist/) ─────────────────────────────
    // Works in both bundled (dist/server.js → dist/ui/) and dev (packages/ui/server.ts → packages/ui/dist/)
    const distCandidates = [
      join(import.meta.dir, "ui"),    // bundled: dist/ui/
      join(import.meta.dir, "dist"),  // dev: packages/ui/dist/
    ];
    const distDir = distCandidates.find((d) => existsSync(join(d, "index.html")));
    if (distDir) {
      // Strip leading slash, default to index.html
      let filePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      let fullPath = join(distDir, filePath);

      // If the file doesn't exist, serve index.html (SPA client-side routing)
      if (!existsSync(fullPath)) {
        fullPath = join(distDir, "index.html");
      }

      const file = Bun.file(fullPath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`ctx-link UI server running at http://localhost:${server.port}`);
