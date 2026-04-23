import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushSessionToCloud } from "@/lib/api";
import { toast } from "sonner";

export function usePushToCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, teamId }: { sessionId: string; teamId: string }) =>
      pushSessionToCloud(sessionId, { team_id: teamId }),

    onSuccess: (data) => {
      toast.success(`Session pushed to cloud. ${data.entries_synced} entries synced.`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
