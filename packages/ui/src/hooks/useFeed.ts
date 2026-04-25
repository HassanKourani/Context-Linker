import { useQuery } from "@tanstack/react-query";
import { fetchTeamFeed } from "@/lib/api";
import { useGraphData } from "./useGraphData";
import type { FeedEvent } from "@/types";

/**
 * Fetch feed events from all connected teams (or a single team if filtered).
 * Merges results from multiple teams, sorted newest-first.
 */
export function useFeed(filterTeamId?: string | null) {
  const { data: graphData } = useGraphData();
  const teamIds = filterTeamId
    ? [filterTeamId]
    : (graphData?.teams?.map(t => t.team_id) ?? []);

  return useQuery({
    queryKey: ["feed", filterTeamId ?? "all", teamIds.join(",")],
    queryFn: async (): Promise<FeedEvent[]> => {
      if (teamIds.length === 0) return [];
      const results = await Promise.all(
        teamIds.map(id => fetchTeamFeed(id, 50, 0)),
      );
      const merged = results.flat();
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return merged.slice(0, 100);
    },
    enabled: teamIds.length > 0,
    refetchInterval: 30_000,
  });
}
