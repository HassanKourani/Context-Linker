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
      mode?: "local" | "cloud";
    }) => connectSessionToBundle(sessionId, { bundle_id }),

    onMutate: async ({ sessionId, bundle_id, mode }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      // Resolve mode from graph data if not provided
      const resolvedMode = mode ?? (() => {
        if (!prev) return "local" as const;
        for (const team of prev.teams) {
          if (team.bundles.some((b) => b.bundle_id === bundle_id)) return "cloud" as const;
        }
        return "local" as const;
      })();

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;

        // Try active sessions first
        const isActiveSession = old.sessions?.some((s) => s.session_id === sessionId);
        if (isActiveSession && old.sessions) {
          return {
            ...old,
            sessions: old.sessions.map((s) =>
              s.session_id === sessionId
                ? { ...s, bundles: [...s.bundles, { bundle_id, mode: resolvedMode }] }
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
                ? { ...cs, bundles: [...(cs.bundles ?? []), { bundle_id, mode: resolvedMode }] }
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
