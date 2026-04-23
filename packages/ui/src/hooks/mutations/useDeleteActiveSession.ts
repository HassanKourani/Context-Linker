import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSessionApi } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useDeleteActiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSessionApi(sessionId),

    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          sessions: old.sessions?.filter((s) => s.session_id !== sessionId),
        };
      });

      return { prev };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(["graph"], ctx.prev);
      toast.error(_err.message);
    },

    onSuccess: () => {
      toast.success("Session deleted");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
