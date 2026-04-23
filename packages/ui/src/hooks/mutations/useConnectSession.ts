import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectSessionToBundle } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useConnectSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      bundle_id,
    }: {
      sessionId: string;
      bundle_id: string;
    }) => connectSessionToBundle(sessionId, { bundle_id }),

    onMutate: async ({ sessionId, bundle_id }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old?.sessions) return old;
        return {
          ...old,
          sessions: old.sessions.map((s) =>
            s.session_id === sessionId
              ? { ...s, bundles: [...s.bundles, { bundle_id, mode: "local" as const }] }
              : s
          ),
        };
      });

      return { prev };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(["graph"], ctx.prev);
      toast.error(_err.message);
    },

    onSuccess: () => {
      toast.success("Session connected to bundle");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
