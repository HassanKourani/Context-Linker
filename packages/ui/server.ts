import {
  loadGlobalConfig,
  listMyTeams,
  listBundleSessions,
  listAllLocalBundleDetails,
} from "@ctx-link/core";
import { listTeamBundles } from "@ctx-link/core";
import { bundleStatus } from "@ctx-link/core";

const server = Bun.serve({
  port: 5174,
  async fetch(req) {
    const url = new URL(req.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/graph") {
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

        return Response.json(
          {
            machine_id: config.machine_id,
            teams: teamData,
            local: { bundles: localBundles },
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

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`ctx-link UI API running at http://localhost:${server.port}`);
