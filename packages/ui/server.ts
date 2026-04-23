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
  localRemoveSessionRefsFromBundle,
  createTeam,
  joinTeam,
  getSessionEntries,
  pushSessionEntry,
  deleteSessionEntry,
  connectSessionToBundle,
  disconnectSessionFromBundle,
  deleteActiveSession,
  loadActiveSession,
  copySessionToCloud,
  listTeamSessions,
  deleteCloudSession,
  deleteCloudSessionEntry,
  getCloudSessionEntries,
  getCloudSessionBundleIds,
  syncCloudSessionFromLocal,
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
            // Enrich cloud sessions with entry counts and bundle connections
            const enrichedSessions = await Promise.all(
              cloudSessions.map(async (cs) => {
                const [entries, connectedBundles] = await Promise.all([
                  getCloudSessionEntries(cs.id),
                  getCloudSessionBundleIds(cs.id),
                ]);
                return {
                  ...cs,
                  entry_count: entries.length,
                  bundles: connectedBundles,
                };
              })
            );

            return {
              team_id: team.team_id,
              team_name: team.name,
              bundles: bundlesWithDetails,
              cloud_sessions: enrichedSessions,
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
          // Try local session entries first
          const localEntries = getSessionEntries(sessionId);
          if (localEntries.length > 0) {
            return Response.json(localEntries, { headers: corsHeaders });
          }
          // Fall back to cloud session entries
          const cloudEntries = await getCloudSessionEntries(sessionId);
          return Response.json(cloudEntries, { headers: corsHeaders });
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

          // Cloud bundle: not allowed for local sessions (use copy-to-cloud flow instead)
          return Response.json(
            { error: "Use 'Copy to Cloud' to push a local session's entries to a cloud bundle." },
            { status: 400, headers: corsHeaders }
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

          const result = await copySessionToCloud(sessionId, team_id);

          // If a bundle_id was provided, add the cloud entries to it
          if (bundle_id) {
            const bundleTeamId = await getBundleTeamId(bundle_id);
            if (bundleTeamId !== team_id) {
              return Response.json(
                { error: "Bundle and session must be in the same team." },
                { status: 400, headers: corsHeaders }
              );
            }
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

    // ── POST /api/sessions/:id/sync-from-local ────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/sync-from-local$/);
      if (match && req.method === "POST") {
        try {
          const cloudSessionId = match[1];
          const result = await syncCloudSessionFromLocal(cloudSessionId);
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

          // Check if this is an active (local) session
          const activeSession = loadActiveSession(sessionId);

          if (activeSession) {
            // Block local sessions from connecting to cloud bundles
            if (mode === "cloud") {
              return Response.json(
                { error: "Use 'Copy to Cloud' to connect a local session to a cloud bundle." },
                { status: 400, headers: corsHeaders }
              );
            }
            // Local active session → local bundle: normal path
            const session = connectSessionToBundle(sessionId, bundle_id, mode);
            return Response.json({ ok: true, session }, { headers: corsHeaders });
          }

          // Not an active session — must be a cloud session ID
          // Get its entries and add refs to the bundle
          const cloudEntries = await getCloudSessionEntries(sessionId);
          const entryIds = cloudEntries.map((e: any) => e.id);

          if (mode === "local") {
            // Cloud session → local bundle: add entry refs
            if (entryIds.length > 0) {
              localAddEntriesToBundle(bundle_id, entryIds, sessionId);
            }
          } else {
            // Cloud session → cloud bundle: add entry refs via Supabase
            if (entryIds.length > 0) {
              await addEntriesToBundle(bundle_id, entryIds);
            }
          }

          return Response.json({ ok: true, entries_added: entryIds.length }, { headers: corsHeaders });
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

          // Try deleting as a local active session
          const session = loadActiveSession(sessionId);
          if (session) {
            deleteActiveSession(sessionId);
          }

          // Also try deleting as a cloud session (sessionId might be a cloud session ID)
          try { await deleteCloudSession(sessionId); } catch {}

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


        // Resolve the local session ID (session_id might be a cloud session ID)
        let localSessionId = session_id;
        const directSession = loadActiveSession(session_id);
        if (!directSession) {
          // session_id might be a cloud session ID — find the matching active session
          const allSessions = listActiveSessions();
          const match = allSessions.find((s) => s.cloud_session_id === session_id);
          if (match) localSessionId = match.session_id;
        }

        // Get all entry IDs from the local session file
        const entries = getSessionEntries(localSessionId);
        const entryIds = entries.map((e) => e.id);


        // Remove entry refs from the bundle
        if (mode === "local") {
          localRemoveSessionRefsFromBundle(bundle_id, localSessionId);
          // Also try with the original session_id in case it differs
          if (localSessionId !== session_id) {
            localRemoveSessionRefsFromBundle(bundle_id, session_id);
          }
        } else if (entryIds.length > 0) {
          // Cloud: remove individual entry refs
          for (const entryId of entryIds) {
            try { await removeEntryFromBundle(bundle_id, entryId); } catch {}
          }
        }

        // Disconnect the session from the bundle
        disconnectSessionFromBundle(localSessionId, bundle_id);
        // Also try with original session_id
        if (localSessionId !== session_id) {
          disconnectSessionFromBundle(session_id, bundle_id);
        }

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
