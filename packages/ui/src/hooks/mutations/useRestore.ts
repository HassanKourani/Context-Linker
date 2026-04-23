import { useMutation, useQueryClient } from "@tanstack/react-query";
import { restoreEntries } from "@/lib/api";
import { toast } from "sonner";

export function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bundleId,
      ...body
    }: {
      bundleId: string;
      project_name: string;
      entry_ids?: string[];
      rewind_log_id?: string;
    }) => restoreEntries(bundleId, body),

    onSuccess: (data) => {
      toast.success(`Restored ${data.restored_count} entries`);
      // No good way to optimistically restore — just refetch
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["rewinds"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
