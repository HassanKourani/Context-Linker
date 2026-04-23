import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushSessionToBundle } from "@/lib/api";
import { toast } from "sonner";

export function usePushSessionToBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      bundle_id,
      entry_ids,
    }: {
      sessionId: string;
      bundle_id: string;
      entry_ids?: string[];
    }) => pushSessionToBundle(sessionId, { bundle_id, entry_ids }),

    onSuccess: (data) => {
      const parts = [];
      if (data.pushed > 0) parts.push(`${data.pushed} pushed`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped (already in bundle)`);
      toast.success(`Entries: ${parts.join(", ")}`);
    },

    onError: (err) => {
      toast.error(err.message);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["session-entries"] });
    },
  });
}
