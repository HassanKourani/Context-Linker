import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteBundle } from "@/lib/api";
import { toast } from "sonner";
import type { GraphData } from "@/types";

export function useDeleteBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "local" | "cloud" }) =>
      deleteBundle(id, mode),

    onMutate: async ({ id, mode }) => {
      await qc.cancelQueries({ queryKey: ["graph"] });
      const prev = qc.getQueryData<GraphData>(["graph"]);

      qc.setQueryData<GraphData>(["graph"], (old) => {
        if (!old) return old;
        if (mode === "local") {
          return {
            ...old,
            local: {
              bundles: old.local.bundles.filter((b) => b.bundle_id !== id),
            },
          };
        }
        return {
          ...old,
          teams: old.teams.map((t) => ({
            ...t,
            bundles: t.bundles.filter((b) => b.bundle_id !== id),
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
      toast.success("Bundle deleted");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
