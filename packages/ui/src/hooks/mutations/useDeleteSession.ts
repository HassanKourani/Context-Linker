import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unlinkSession } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData, EntryRow } from "@/types";

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      session_id: string;
      bundle_id: string;
    }) => unlinkSession(params),

    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      await qc.cancelQueries({ queryKey: ["entries", params.bundle_id] });
      const prev = qc.getQueryData<GraphData>(["graph"]);
      const prevEntries = qc.getQueryData<EntryRow[]>(["entries", params.bundle_id]);

      // Find the project_name for this session so we can filter entries
      let sessionProjectName: string | null = null;
      let sessionEntryCount = 0;
      if (prev) {
        // Check active sessions
        const activeSession = prev.sessions?.find((s) => s.session_id === params.session_id);
        if (activeSession) {
          sessionProjectName = activeSession.project_name;
          sessionEntryCount = activeSession.entry_count ?? 0;
        }
        // Check cloud sessions
        if (!sessionProjectName) {
          for (const t of prev.teams) {
            const cs = t.cloud_sessions?.find((c) => c.id === params.session_id);
            if (cs) {
              sessionProjectName = cs.project_name;
              sessionEntryCount = cs.entry_count ?? 0;
              break;
            }
          }
        }
      }

      // Optimistically remove entries from the bundle's entry cache
      if (sessionProjectName && prevEntries) {
        qc.setQueryData<EntryRow[]>(["entries", params.bundle_id], (old) =>
          old?.filter((e) => e.project_name !== sessionProjectName) ?? []
        );
      }

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
          // Remove the bundle connection from cloud sessions (don't remove the session itself)
          teams: old.teams.map((t) => ({
            ...t,
            bundles: t.bundles.map((b) =>
              b.bundle_id === params.bundle_id
                ? { ...b, entry_count: Math.max(0, b.entry_count - sessionEntryCount) }
                : b
            ),
            cloud_sessions: t.cloud_sessions?.map((cs) =>
              cs.id === params.session_id
                ? { ...cs, bundles: cs.bundles?.filter((b) => b.bundle_id !== params.bundle_id) }
                : cs
            ),
          })),
          // Also remove local projects + adjust entry counts
          local: {
            bundles: old.local.bundles.map((b) =>
              b.bundle_id === params.bundle_id
                ? {
                    ...b,
                    projects: b.projects.filter((p) => p.project_name !== params.session_id),
                    entry_count: Math.max(0, b.entry_count - sessionEntryCount),
                  }
                : b
            ),
          },
        };
      });

      return { prev, prevEntries };
    },

    onError: (_err, params, ctx) => {
      if (ctx?.prev) qc.setQueryData(["graph"], ctx.prev);
      if (ctx?.prevEntries) qc.setQueryData(["entries", params.bundle_id], ctx.prevEntries);
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
