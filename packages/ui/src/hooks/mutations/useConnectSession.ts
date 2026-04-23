import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectSessionToBundle } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData, ActiveSessionData } from "@/types";

export function useConnectSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      bundle_id,
      mode,
    }: {
      sessionId: string;
      bundle_id: string;
      mode: "local" | "cloud";
    }) => connectSessionToBundle(sessionId, { bundle_id, mode }),

    onMutate: async ({ sessionId, bundle_id, mode }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      // Optimistically add bundle to the session's bundles array
      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old?.sessions) return old;
        return {
          ...old,
          sessions: old.sessions.map((s) =>
            s.session_id === sessionId
              ? { ...s, bundles: [...s.bundles, { bundle_id, mode }] }
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
