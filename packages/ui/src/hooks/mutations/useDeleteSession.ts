import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unlinkSession } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      session_id: string;
      bundle_id: string;
    }) => unlinkSession(params),

    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          // Remove from active sessions' bundles arrays
          sessions: old.sessions?.map((s) =>
            s.session_id === params.session_id
              ? { ...s, bundles: s.bundles.filter((b) => b.bundle_id !== params.bundle_id) }
              : s
          ),
          // Also remove cloud sessions
          teams: old.teams.map((t) => ({
            ...t,
            cloud_sessions: t.cloud_sessions?.filter(
              (cs) => cs.id !== params.session_id
            ),
          })),
          // Also remove local projects
          local: {
            bundles: old.local.bundles.map((b) =>
              b.bundle_id === params.bundle_id
                ? { ...b, projects: b.projects.filter((p) => p.project_name !== params.session_id) }
                : b
            ),
          },
        };
      });

      return { prev };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(["graph"], ctx.prev);
      toast.error(_err.message);
    },

    onSuccess: () => {
      toast.success("Session unlinked");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
