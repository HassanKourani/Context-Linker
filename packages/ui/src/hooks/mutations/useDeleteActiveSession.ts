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

      // Find the project name for this session so we can remove entries from bundles
      const session = prev?.sessions?.find((s) => s.session_id === sessionId);
      const projectName = session?.project_name;

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          // Remove from active sessions
          sessions: old.sessions?.filter((s) => s.session_id !== sessionId),
          // Remove from cloud team bundles' sessions + entries
          teams: old.teams.map((t) => ({
            ...t,
            bundles: t.bundles.map((b) => ({
              ...b,
              sessions: b.sessions.filter((s) => s.session_id !== sessionId),
              entry_count: projectName
                ? Math.max(0, b.entry_count - b.sessions.filter((s) => s.session_id === sessionId).length)
                : b.entry_count,
            })),
          })),
          // Remove from local bundles' projects
          local: {
            bundles: old.local.bundles.map((b) => ({
              ...b,
              projects: projectName
                ? b.projects.filter((p) => p.project_name !== projectName)
                : b.projects,
            })),
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
      toast.success("Session deleted");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
}
