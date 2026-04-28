import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EntryRow } from "@/types";

type AddNoteVars = {
  bundleId: string;
  project_name: string;
  event_type: string;
  summary: string;
};

type AddNoteResult = {
  bundle_id: string;
  session_id: string;
  entry_id: string;
};

export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation<AddNoteResult, Error, AddNoteVars, { prev?: EntryRow[]; key: ["entries", string] }>({
    mutationFn: async ({ bundleId, project_name, event_type, summary }) => {
      const res = await fetch(`/api/bundles/${bundleId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_name, event_type, summary }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `API error: ${res.status}`);
      }
      return res.json();
    },

    onMutate: async ({ bundleId, project_name, event_type, summary }) => {
      const key = ["entries", bundleId] as ["entries", string];
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
