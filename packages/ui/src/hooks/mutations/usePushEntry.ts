import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushEntry } from "@/lib/api";
import { toast } from "sonner";
import type { EntryRow } from "@/types";

export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bundleId,
      ...body
    }: {
      bundleId: string;
      project_name: string;
      event_type: string;
      summary: string;
    }) => pushEntry(bundleId, body),

    onMutate: async ({ bundleId, project_name, event_type, summary }) => {
      const key = ["entries", bundleId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<EntryRow[]>(key);

      const optimistic: EntryRow = {
        id: `optimistic-${Date.now()}`,
        created_at: new Date().toISOString(),
        project_name,
        event_type,
        trigger_ref: null,
        summary,
        files_touched: [],
        decisions: [],
      };

      qc.setQueryData<EntryRow[]>(key, (old) =>
        old ? [optimistic, ...old] : [optimistic]
      );

      return { prev, key };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(_err.message);
    },

    onSuccess: () => {
      toast.success("Entry pushed");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
