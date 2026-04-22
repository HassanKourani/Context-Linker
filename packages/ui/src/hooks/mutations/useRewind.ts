import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rewindEntries } from "@/lib/api";
import { toast } from "sonner";

export function useRewind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId, ...body }: { bundleId: string; project_name: string; strategy: unknown; reason?: string; dry_run?: boolean; force?: boolean }) =>
      rewindEntries(bundleId, body),
    onSuccess: (data) => {
      if (data.dry_run) {
        toast.info(`Dry run: ${data.affected_count} entries would be rewound`);
      } else if (data.applied) {
        toast.success(`Rewound ${data.affected_count} entries`);
        qc.invalidateQueries({ queryKey: ["entries"] });
        qc.invalidateQueries({ queryKey: ["rewinds"] });
        qc.invalidateQueries({ queryKey: ["graph"] });
      } else {
        toast.warning(data.message || "Rewind not applied");
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
