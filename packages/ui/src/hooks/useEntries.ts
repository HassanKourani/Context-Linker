import { useQuery } from "@tanstack/react-query";
import { fetchEntries } from "@/lib/api";

export function useEntries(bundleId: string | null, mode: "local" | "cloud" = "cloud") {
  return useQuery({
    queryKey: ["entries", bundleId, mode],
    queryFn: () => fetchEntries(bundleId!, { mode, limit: 100 }),
    enabled: !!bundleId,
  });
}
