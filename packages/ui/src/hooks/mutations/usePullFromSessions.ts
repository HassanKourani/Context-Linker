import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pullFromSessions } from "@/lib/api";
import { toast } from "sonner";

export function usePullFromSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId }: { bundleId: string }) =>
      pullFromSessions(bundleId),

    onSuccess: (data) => {
      const parts = [];
      if (data.pushed > 0) parts.push(`${data.pushed} pulled`);
      if (data.skipped > 0) parts.push(`${data.skipped} already in bundle`);
      if (data.pushed === 0 && data.skipped === 0) {
        toast.info("No new entries to pull");
      } else {
        toast.success(`Entries: ${parts.join(", ")}`);
      }
    },

    onError: (err) => {
      toast.error(err.message);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
