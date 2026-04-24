import { useMutation, useQueryClient } from "@tanstack/react-query";
import { renameSessionApi } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string | null }) =>
      renameSessionApi(sessionId, name),

    onMutate: async ({ sessionId, name }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          sessions: old.sessions?.map((s) =>
            s.session_id === sessionId ? { ...s, name } : s
          ),
          teams: old.teams.map((t) => ({
            ...t,
            cloud_sessions: t.cloud_sessions?.map((cs) =>
              cs.id === sessionId ? { ...cs, name } : cs
            ),
          })),
        };
      });

      return { prev };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(["graph"], ctx.prev);
      toast.error(_err.message);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
