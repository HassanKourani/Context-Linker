import { useMutation, useQueryClient } from "@tanstack/react-query";
import { copySessionToCloud } from "@/lib/api";
import { toast } from "sonner";

export function useCopyToCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      teamId,
      bundleId,
    }: {
      sessionId: string;
      teamId: string;
      bundleId?: string;
    }) => copySessionToCloud(sessionId, { team_id: teamId, bundle_id: bundleId }),

    onSuccess: (data) => {
      toast.success(`Session copied to cloud. ${data.entries_copied} entries copied.`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
