import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushBundleToCloud } from "@/lib/api";
import { toast } from "sonner";

export function usePushBundleToCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId, teamId }: { bundleId: string; teamId: string }) =>
      pushBundleToCloud(bundleId, { team_id: teamId }),

    onSuccess: (data) => {
      toast.success(`Bundle pushed to cloud. ${data.entries_migrated} entries migrated.`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
