import { useQuery } from "@tanstack/react-query";
import { fetchSessionEntries } from "@/lib/api";

export function useSessionEntries(sessionId: string | null) {
  return useQuery({
    queryKey: ["session-entries", sessionId],
    queryFn: () => fetchSessionEntries(sessionId!),
    enabled: !!sessionId,
  });
}
