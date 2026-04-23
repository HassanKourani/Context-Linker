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
  removeEntryFromBundle,
  localAddEntriesToBundle,
  localRemoveEntryFromBundle,
  createTeam,
  joinTeam,
  getSessionEntries,
  pushSessionEntry,
  deleteSessionEntry,
  connectSessionToBundle,
  disconnectSessionFromBundle,
  deleteActiveSession,
  loadActiveSession,
  pushSessionToCloud,
  listTeamSessions,
  syncNewEntries,
  deleteCloudSession,
  deleteCloudSessionEntry,
  getBundleTeamId,
  rewindProject,
  restoreRewound,
  listRewinds,
  localRewindProject,
  localRestoreRewound,
  localListRewinds,
} from "@ctx-link/core";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 5174,
  async fetch(req) {
    const url = new URL(req.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

        const teamData = await Promise.all(
          teams.map(async (team) => {
            const [bundles, cloudSessions] = await Promise.all([
              listTeamBundles(team.team_id),
              listTeamSessions(team.team_id),
            ]);
            const bundlesWithDetails = await Promise.all(
              bundles.map(async (b) => {
                const status = await bundleStatus(b.bundle_id, "cloud", true);
                return {
                  bundle_id: b.bundle_id,
                  bundle_name: b.name,
                  entry_count: status.entry_count,
                  last_entry_at: status.last_entry_at,
                };
              })
            );
            return {
              team_id: team.team_id,
              team_name: team.name,
              bundles: bundlesWithDetails,
              cloud_sessions: cloudSessions,
            };
          })
        );

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

          // Disconnect all active sessions from this bundle first
          const activeSessions = listActiveSessions();
          for (const s of activeSessions) {
            if (s.bundles.some((b) => b.bundle_id === bundleId)) {
              disconnectSessionFromBundle(s.session_id, bundleId);
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
          const mode = resolveBundleMode(bundleId);
          if (mode === "local") {
            localRemoveEntryFromBundle(bundleId, entryId);
          } else {
            await removeEntryFromBundle(bundleId, entryId);
          }
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
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
          const mode = resolveBundleMode(bundleId);

          const result = mode === "local"
            ? localRewindProject({ bundle_id: bundleId, project_name, strategy, reason, dry_run, force })
            : await rewindProject({ bundle_id: bundleId, project_name, strategy, reason, dry_run, force });
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
          const mode = resolveBundleMode(bundleId);

          const result = mode === "local"
            ? localRestoreRewound({ bundle_id: bundleId, project_name, entry_ids, rewind_log_id })
            : await restoreRewound({ bundle_id: bundleId, project_name, entry_ids, rewind_log_id });
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
          const mode = resolveBundleMode(bundleId);
          const rewinds = mode === "local"
            ? localListRewinds(bundleId, project_name, limit)
            : await listRewinds(bundleId, project_name, limit);
          return Response.json(rewinds, { headers: corsHeaders });
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
          const entries = getSessionEntries(sessionId);
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
          const mode = resolveBundleMode(bundle_id);

          // Ensure session is connected to this bundle
          try {
            connectSessionToBundle(sessionId, bundle_id, mode);
          } catch {
            // Already connected — that's fine
          }

          const allEntries = getSessionEntries(sessionId);
          const ids = entry_ids ? entry_ids as string[] : allEntries.map((e) => e.id);

          if (mode === "local") {
            const result = localAddEntriesToBundle(bundle_id, ids, sessionId);
            return Response.json(
              { ok: true, pushed: result.added, skipped: result.skipped, total: ids.length },
              { headers: corsHeaders }
            );
          }

          // Cloud bundle: session must already be in the cloud
          const session = loadActiveSession(sessionId);
          if (session && !session.cloud_session_id) {
            return Response.json(
              { error: "Push session to cloud first before pushing entries to a cloud bundle." },
              { status: 400, headers: corsHeaders }
            );
          }
          if (session?.cloud_session_id) {
            await syncNewEntries(session);
          }

          const result = await addEntriesToBundle(bundle_id, ids);
          return Response.json(
            { ok: true, pushed: result.added, skipped: result.skipped, total: ids.length },
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

    // ── POST /api/sessions/:id/push-to-cloud ──────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/push-to-cloud$/);
      if (match && req.method === "POST") {
        try {
          const sessionId = match[1];
          const { team_id } = await req.json();
          const result = await pushSessionToCloud(sessionId, team_id);
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

          // Block local-only sessions from connecting to cloud bundles
          // User must push session to cloud first
          if (mode === "cloud") {
            const sess = loadActiveSession(sessionId);
            if (sess && !sess.cloud_session_id) {
              return Response.json(
                { error: "Push session to cloud first before connecting to a cloud bundle." },
                { status: 400, headers: corsHeaders }
              );
            }
          }

          const session = connectSessionToBundle(sessionId, bundle_id, mode);
          return Response.json({ ok: true, session }, { headers: corsHeaders });
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
          deleteSessionEntry(sessionId, entryId);
          const session = loadActiveSession(sessionId);
          if (session?.cloud_session_id) {
            try { await deleteCloudSessionEntry(entryId); } catch {}
          }
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
          const sessionId = match[1];

          // Delete cloud session if it exists
          const session = loadActiveSession(sessionId);
          if (session?.cloud_session_id) {
            try { await deleteCloudSession(session.cloud_session_id); } catch {}
          }

          // Delete the active session + its session-entries file
          deleteActiveSession(sessionId);

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
        const mode = resolveBundleMode(bundle_id);

        // Collect entry IDs to remove from the bundle.
        // session_id could be a local active session ID or a cloud session ID.
        let entryIds: string[] = [];

        // 1. Try local session entries
        const localEntries = getSessionEntries(session_id);
        if (localEntries.length > 0) {
          entryIds = localEntries.map((e) => e.id);
        }

        // 2. If no local entries, check if an active session has this as cloud_session_id
        if (entryIds.length === 0) {
          const allSessions = listActiveSessions();
          const match = allSessions.find((s) => s.cloud_session_id === session_id);
          if (match) {
            const entries = getSessionEntries(match.session_id);
            entryIds = entries.map((e) => e.id);
          }
        }

        // 3. For local bundles, also remove refs by session_id directly from entry_refs.json
        if (mode === "local") {
          const { localRemoveSessionRefsFromBundle } = await import("@ctx-link/core");
          localRemoveSessionRefsFromBundle(bundle_id, session_id);
        }

        // Remove individual entry refs
        if (entryIds.length > 0) {
          if (mode === "local") {
            for (const entryId of entryIds) {
              localRemoveEntryFromBundle(bundle_id, entryId);
            }
          } else {
            for (const entryId of entryIds) {
              try { await removeEntryFromBundle(bundle_id, entryId); } catch {}
            }
          }
        }

        disconnectSessionFromBundle(session_id, bundle_id);
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

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`ctx-link UI API running at http://localhost:${server.port}`);
