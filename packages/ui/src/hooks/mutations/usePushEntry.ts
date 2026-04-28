import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EntryRow } from "@/types";
import { addBundleNote, type AddBundleNoteResult } from "@/lib/api";

type AddNoteVars = {
  bundleId: string;
  role: string;
  summary: string;
};

export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation<AddBundleNoteResult, Error, AddNoteVars, { prev?: EntryRow[]; key: ["entries", string] }>({
    mutationFn: ({ bundleId, role, summary }) => addBundleNote(bundleId, { summary, role }),

    onMutate: async ({ bundleId, role, summary }) => {
      const key = ["entries", bundleId] as ["entries", string];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<EntryRow[]>(key);

      const optimistic: EntryRow = {
        id: `optimistic-${Date.now()}`,
        created_at: new Date().toISOString(),
        project_name: "",
        event_type: "manual",
        trigger_ref: null,
        summary,
        files_touched: [],
        decisions: [],
        role,
      };
      qc.setQueryData<EntryRow[]>(key, (old) =>
        old ? [optimistic, ...old] : [optimistic]
      );
      return { prev, key };
    },

    onError: (err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err.message);
    },

    onSuccess: () => {
      toast.success("Note added");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
