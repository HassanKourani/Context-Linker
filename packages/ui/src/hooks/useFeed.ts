import { useQuery } from "@tanstack/react-query";
import { fetchTeamFeed } from "@/lib/api";

export function useFeed(teamId: string | null) {
  return useQuery({
    queryKey: ["feed", teamId],
    queryFn: () => fetchTeamFeed(teamId!),
    enabled: !!teamId,
    refetchInterval: 30_000,
  });
}
