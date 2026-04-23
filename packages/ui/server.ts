import {
  loadGlobalConfig,
  loadSessionLog,
  listActiveSessions,
  listMyTeams,
  listBundleSessions,
  listAllLocalBundleDetails,
  listTeamBundles,
  bundleStatus,
  createBundle,
  deleteBundle,
  joinBundle,
  deleteSession,
  getBundleToken,
  pushEntry,
  pullEntries,
  rewindProject,
  restoreRewound,
  listRewinds,
  createTeam,
  joinTeam,
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

    // ── GET /api/graph ────────────────────────────────────────────────────────
    if (url.pathname === "/api/graph" && req.method === "GET") {
      try {
        const config = loadGlobalConfig();
        const teams = listMyTeams();

        const teamData = await Promise.all(
          teams.map(async (team) => {
            const bundles = await listTeamBundles(team.team_id);
            const bundlesWithDetails = await Promise.all(
              bundles.map(async (b) => {
                const [status, sessions] = await Promise.all([
                  bundleStatus(b.bundle_id, "cloud"),
                  listBundleSessions(b.bundle_id),
                ]);
                return {
                  bundle_id: b.bundle_id,
                  bundle_name: b.name,
                  entry_count: status.entry_count,
                  last_entry_at: status.last_entry_at,
                  sessions: sessions.map((s) => ({
                    session_id: s.session_id,
                    project_name: s.project_name,
                    machine_id: s.machine_id,
                    last_active_at: s.last_active_at,
                  })),
                };
              })
            );
            return {
              team_id: team.team_id,
              team_name: team.name,
              bundles: bundlesWithDetails,
            };
          })
        );

        const localBundles = listAllLocalBundleDetails();
        const sessions = listActiveSessions();

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
          const mode = (url.searchParams.get("mode") || "cloud") as "local" | "cloud";
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
          const { project_name, mode } = await req.json();
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

    // ── GET /api/bundles/:id/entries ──────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/entries$/);
      if (match && req.method === "GET") {
        try {
          const bundleId = match[1];
          const since = url.searchParams.get("since") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "50");
          const exclude_project = url.searchParams.get("exclude_project") || undefined;
          const mode = (url.searchParams.get("mode") || "cloud") as "local" | "cloud";
          const entries = await pullEntries({
            bundle_id: bundleId,
            since,
            limit,
            exclude_project,
            mode,
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

    // ── POST /api/bundles/:id/entries ─────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/entries$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { project_name, event_type, summary, files_touched, decisions, mode } =
            await req.json();
          const result = await pushEntry({
            bundle_id: bundleId,
            project_name,
            event_type,
            summary,
            files_touched,
            decisions,
            raw_context: "",
            mode,
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

    // ── POST /api/bundles/:id/rewind ──────────────────────────────────────────
    {
      const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/rewind$/);
      if (match && req.method === "POST") {
        try {
          const bundleId = match[1];
          const { project_name, strategy, reason, dry_run, force } = await req.json();
          const result = await rewindProject({
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
          const result = await restoreRewound({
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
          const rewinds = await listRewinds(bundleId, project_name, limit);
          return Response.json(rewinds, { headers: corsHeaders });
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
          await deleteSession(sessionId);
          return Response.json({ ok: true }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json(
            { error: err.message ?? String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
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
