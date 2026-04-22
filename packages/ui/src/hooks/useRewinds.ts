import { useQuery } from "@tanstack/react-query";
import { fetchRewinds } from "@/lib/api";

export function useRewinds(bundleId: string | null) {
  return useQuery({
    queryKey: ["rewinds", bundleId],
    queryFn: () => fetchRewinds(bundleId!),
    enabled: !!bundleId,
  });
}
