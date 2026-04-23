import { useQuery } from "@tanstack/react-query";
import { fetchEntries } from "@/lib/api";

export function useEntries(bundleId: string | null) {
  return useQuery({
    queryKey: ["entries", bundleId],
    queryFn: () => fetchEntries(bundleId!, { limit: 100 }),
    enabled: !!bundleId,
  });
}
