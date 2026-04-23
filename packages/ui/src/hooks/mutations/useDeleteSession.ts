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
      project_name: string;
      mode: "local" | "cloud";
    }) => unlinkSession(params),

    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          teams: old.teams.map((t) => ({
            ...t,
            bundles: t.bundles.map((b) => ({
              ...b,
              sessions: b.sessions.filter(
                (s) => s.session_id !== params.session_id
              ),
            })),
          })),
          local: {
            bundles: old.local.bundles.map((b) =>
              b.bundle_id === params.bundle_id
                ? {
                    ...b,
                    projects: b.projects.filter(
                      (p) => p.project_name !== params.project_name
                    ),
                  }
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
