import { useMutation, useQueryClient } from "@tanstack/react-query";
import { joinBundle } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useJoinBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bundleId,
      project_name,
    }: {
      bundleId: string;
      project_name: string;
    }) => joinBundle(bundleId, { project_name }),

    onMutate: async ({ bundleId, project_name }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      // Optimistically add to both local and cloud (server resolves which)
      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        return {
          ...old,
          local: {
            bundles: old.local.bundles.map((b) =>
              b.bundle_id === bundleId
                ? {
                    ...b,
                    projects: [
                      ...b.projects,
                      { project_name, last_entry_at: new Date().toISOString() },
                    ],
                  }
                : b
            ),
          },
          teams: old.teams.map((t) => ({
            ...t,
            bundles: t.bundles.map((b) =>
              b.bundle_id === bundleId
                ? {
                    ...b,
                    sessions: [
                      ...b.sessions,
                      {
                        session_id: `optimistic-${Date.now()}`,
                        project_name,
                        machine_id: old.machine_id,
                        last_active_at: new Date().toISOString(),
                      },
                    ],
                  }
                : b
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

    onSuccess: (data) => {
      toast.success(`Linked to "${data.name}"`);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
