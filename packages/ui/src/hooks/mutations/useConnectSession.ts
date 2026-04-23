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
        if (!old) return old;

        // Try active sessions first
        const isActiveSession = old.sessions?.some((s) => s.session_id === sessionId);
        if (isActiveSession && old.sessions) {
          return {
            ...old,
            sessions: old.sessions.map((s) =>
              s.session_id === sessionId
                ? { ...s, bundles: [...s.bundles, { bundle_id, mode: "local" as const }] }
                : s
            ),
          };
        }

        // Cloud session — update within team's cloud_sessions
        return {
          ...old,
          teams: old.teams.map((team) => ({
            ...team,
            cloud_sessions: team.cloud_sessions?.map((cs) =>
              cs.id === sessionId
                ? { ...cs, bundles: [...(cs.bundles ?? []), { bundle_id, mode: "cloud" as const }] }
                : cs
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

    onSuccess: () => {
      toast.success("Session connected to bundle");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
