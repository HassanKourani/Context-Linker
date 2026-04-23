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
  removeSessionEntriesFromBundle,
  localAddEntriesToBundle,
  localRemoveEntryFromBundle,
  localRemoveSessionRefsFromBundle,
  localRemoveEntryRefsFromBundleByIds,
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
  getCloudSession,
  getBundleTeamId,
  rewindProject,
  restoreRewound,
  listRewinds,
  localRewindProject,
  localRestoreRewound,
  localListRewinds,
  connectCloudSessionToBundle,
  disconnectCloudSessionFromBundle,
  getCloudSessionBundleConnections,
  syncSessionToCloud,
  saveActiveSession,
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
                const entries = await getCloudSessionEntries(cs.id);
                const bundles = getCloudSessionBundleConnections(cs.id);
                return {
                  ...cs,
                  entry_count: entries.length,
                  bundles,
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
          const mode = resolveBundleMode(bundle_id);

          // Check if this is a local active session or a cloud session
          const localSession = loadActiveSession(sessionId);

          if (localSession) {
            // Local active session
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

            // Cloud bundle — auto-push session to cloud if needed, then add entries
            const bundleTeamId = await getBundleTeamId(bundle_id);
            if (!bundleTeamId) {
              return Response.json(
                { error: "Could not determine the bundle's team." },
                { status: 400, headers: corsHeaders }
              );
            }

            const copies = localSession.cloud_copies ?? [];
            let copy = copies.find((c) => c.team_id === bundleTeamId)
              ?? (localSession.cloud_session_id && localSession.team_id === bundleTeamId
                ? { cloud_session_id: localSession.cloud_session_id, team_id: bundleTeamId }
                : null);

            if (!copy) {
              const result = await copySessionToCloud(sessionId, bundleTeamId);
              if (!localSession.cloud_copies) localSession.cloud_copies = [];
              localSession.cloud_copies.push({ cloud_session_id: result.cloud_session_id, team_id: bundleTeamId });
              if (!localSession.cloud_session_id) {
                localSession.cloud_session_id = result.cloud_session_id;
                localSession.team_id = bundleTeamId;
              }
              saveActiveSession(localSession);
              copy = { cloud_session_id: result.cloud_session_id, team_id: bundleTeamId };
            } else {
              // Sync any new local entries to the existing cloud copy
              await syncSessionToCloud(sessionId, copy.cloud_session_id);
            }

            // Now add the cloud entry IDs to the bundle
            const cloudEntries = await getCloudSessionEntries(copy.cloud_session_id);
            const cloudIds = entry_ids
              ? cloudEntries.filter((e) => ids.includes(e.id)).map((e) => e.id)
              : cloudEntries.map((e) => e.id);

            if (cloudIds.length > 0) {
              await addEntriesToBundle(bundle_id, cloudIds);
            }
            return Response.json(
              { ok: true, pushed: cloudIds.length, skipped: 0, total: cloudIds.length },
              { headers: corsHeaders }
            );
          }

          // Cloud session — push entries to bundle
          const cloudEntries = await getCloudSessionEntries(sessionId);
          const ids = entry_ids ? entry_ids as string[] : cloudEntries.map((e) => e.id);

          if (mode === "local") {
            const result = localAddEntriesToBundle(bundle_id, ids, sessionId);
            return Response.json(
              { ok: true, pushed: result.added, skipped: result.skipped, total: ids.length },
              { headers: corsHeaders }
            );
          } else {
            if (ids.length > 0) {
              await addEntriesToBundle(bundle_id, ids);
            }
            return Response.json(
              { ok: true, pushed: ids.length, skipped: 0, total: ids.length },
              { headers: corsHeaders }
            );
          }
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

    // ── DELETE /api/sessions/:id/entries/:entryId ───────────────────────────
    {
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/entries\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        try {
          const sessionId = match[1];
          const entryId = match[2];
          deleteSessionEntry(sessionId, entryId);
          const session = loadActiveSession(sessionId);
          if (session?.cloud_copies?.length || session?.cloud_session_id) {
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

          const localSession = loadActiveSession(sessionId);

          if (localSession) {
            // Deleting a local active session — also delete all cloud copies
            for (const c of (localSession.cloud_copies ?? [])) {
              try { await deleteCloudSession(c.cloud_session_id); } catch {}
            }
            // Legacy fallback
            if (localSession.cloud_session_id) {
              try { await deleteCloudSession(localSession.cloud_session_id); } catch {}
            }
            deleteActiveSession(sessionId);
          } else {
            // sessionId is a cloud session ID — only delete from Supabase, keep local
            try { await deleteCloudSession(sessionId); } catch {}

            // Remove from cloud_copies on any local session that had this cloud copy
            const allSessions = listActiveSessions();
            const linked = allSessions.find((s) =>
              s.cloud_session_id === sessionId ||
              (s.cloud_copies ?? []).some((c) => c.cloud_session_id === sessionId)
            );
            if (linked) {
              linked.cloud_copies = (linked.cloud_copies ?? []).filter(
                (c) => c.cloud_session_id !== sessionId
              );
              if (linked.cloud_session_id === sessionId) {
                // Promote next copy or clear
                const next = linked.cloud_copies[0] ?? null;
                linked.cloud_session_id = next?.cloud_session_id ?? null;
                linked.team_id = next?.team_id ?? null;
              }
              saveActiveSession(linked);
            }
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

    // ── POST /api/unlink-session ────────────────────────────────────────────
    if (url.pathname === "/api/unlink-session" && req.method === "POST") {
      try {
        const { session_id, bundle_id } = await req.json();
        const mode = resolveBundleMode(bundle_id);

        // Resolve whether session_id is a local active session or a cloud session
        let localSessionId: string | null = null;
        let cloudSessionId: string | null = null;

        const directSession = loadActiveSession(session_id);
        if (directSession) {
          // session_id is a local active session
          localSessionId = session_id;
          cloudSessionId = directSession.cloud_session_id ?? null;
        } else {
          // session_id might be a cloud session ID
          cloudSessionId = session_id;
          // Check if any active session maps to this cloud session
          const match = listActiveSessions().find((s) =>
            s.cloud_session_id === session_id ||
            (s.cloud_copies ?? []).some((c) => c.cloud_session_id === session_id)
          );
          if (match) localSessionId = match.session_id;
        }

        // Remove entry refs from the bundle
        if (mode === "local") {
          // Try removing by local session ID
          if (localSessionId) {
            localRemoveSessionRefsFromBundle(bundle_id, localSessionId);
          }
          // Also try by cloud session ID (cloud sessions push with their cloud ID as session_id)
          if (cloudSessionId) {
            localRemoveSessionRefsFromBundle(bundle_id, cloudSessionId);
          }
          // Also try matching by entry IDs from the cloud session
          // (in case the entry_refs.session_id doesn't match either ID)
          if (cloudSessionId) {
            try {
              const cloudEntries = await getCloudSessionEntries(cloudSessionId);
              if (cloudEntries.length > 0) {
                localRemoveEntryRefsFromBundleByIds(bundle_id, cloudEntries.map(e => e.id));
              }
            } catch {}
          }
        } else {
          // Cloud bundle: remove entry refs from Supabase
          if (cloudSessionId) {
            const removed = await removeSessionEntriesFromBundle(bundle_id, cloudSessionId);
            console.log("[unlink-cloud] removed", removed, "entry refs for cloud session", cloudSessionId, "from bundle", bundle_id);
          } else {
            console.log("[unlink-cloud] no cloudSessionId resolved, session_id:", session_id);
          }
          // Also try with local session entries if they were synced
          if (localSessionId) {
            const localEntries = getSessionEntries(localSessionId);
            for (const e of localEntries) {
              try { await removeEntryFromBundle(bundle_id, e.id); } catch {}
            }
          }
        }

        // Disconnect the session from the bundle (try all known IDs)
        if (localSessionId) disconnectSessionFromBundle(localSessionId, bundle_id);
        if (cloudSessionId && cloudSessionId !== localSessionId) {
          disconnectSessionFromBundle(cloudSessionId, bundle_id);
        }
        disconnectCloudSessionFromBundle(session_id, bundle_id);
        if (localSessionId && localSessionId !== session_id) {
          disconnectCloudSessionFromBundle(localSessionId, bundle_id);
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
