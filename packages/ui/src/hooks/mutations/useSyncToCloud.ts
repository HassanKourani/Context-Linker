import { useMutation, useQueryClient } from "@tanstack/react-query";
import { syncSessionToCloud } from "@/lib/api";
import { toast } from "sonner";

export function useSyncToCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => syncSessionToCloud(sessionId),

    onSuccess: (data) => {
      if (data.entries_synced > 0) {
        toast.success(`Synced ${data.entries_synced} new entries to cloud.`);
      } else {
        toast.info("Cloud session is already up to date.");
      }
      qc.invalidateQueries({ queryKey: ["graph"] });
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
