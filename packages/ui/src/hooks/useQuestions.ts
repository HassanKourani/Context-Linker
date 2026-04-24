import { useQuery } from "@tanstack/react-query";
import { fetchQuestions } from "@/lib/api";

export function useQuestions(bundleId: string | null, status?: string) {
  return useQuery({
    queryKey: ["questions", bundleId, status],
    queryFn: () => fetchQuestions(bundleId!, { status }),
    enabled: !!bundleId,
    refetchInterval: 10_000,
  });
}
