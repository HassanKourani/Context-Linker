import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSessionEntryApi } from "@/lib/api";
import { toast } from "sonner";
import type { EntryRow } from "@/types";

export function useDeleteSessionEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      entryId,
    }: {
      sessionId: string;
      entryId: string;
    }) => deleteSessionEntryApi(sessionId, entryId),

    onMutate: async ({ sessionId, entryId }) => {
      const key = ["session-entries", sessionId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<EntryRow[]>(key);
      qc.setQueryData<EntryRow[]>(key, (old) =>
        old ? old.filter((e) => e.id !== entryId) : old
      );
      return { prev, key };
    },

    onError: (err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err.message);
    },

    onSettled: (_data, _err, { sessionId }) => {
      qc.invalidateQueries({ queryKey: ["session-entries", sessionId] });
    },
  });
}
