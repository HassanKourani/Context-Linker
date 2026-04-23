import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rewindEntries } from "@/lib/api";
import { toast } from "sonner";
import type { EntryRow } from "@/types";

export function useRewind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bundleId,
      ...body
    }: {
      bundleId: string;
      project_name: string;
      strategy: unknown;
      reason?: string;
      dry_run?: boolean;
      force?: boolean;
    }) => rewindEntries(bundleId, body),

    onMutate: async ({ bundleId, strategy, dry_run }) => {
      if (dry_run) return {};

      // Optimistically remove rewound entries from the list
      const ids =
        (strategy as any)?.kind === "entry_ids"
          ? ((strategy as any).ids as string[])
          : [];
      if (ids.length === 0) return {};

      const idSet = new Set(ids);
      // Invalidate all entry queries for this bundle
      const queries = qc.getQueriesData<EntryRow[]>({ queryKey: ["entries", bundleId] });
      const prevMap: Array<[readonly unknown[], EntryRow[] | undefined]> = [];

      for (const [key, data] of queries) {
        prevMap.push([key, data]);
        if (data) {
          qc.setQueryData<EntryRow[]>(key, data.filter((e) => !idSet.has(e.id)));
        }
      }

      return { prevMap };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prevMap) {
        for (const [key, data] of ctx.prevMap) {
          qc.setQueryData(key, data);
        }
      }
      toast.error(_err.message);
    },

    onSuccess: (data) => {
      if (data.dry_run) {
        toast.info(`Dry run: ${data.affected_count} entries would be rewound`);
      } else if (data.applied) {
        toast.success(`Rewound ${data.affected_count} entries`);
      } else {
        toast.warning(data.message || "Rewind not applied");
      }
    },

    onSettled: (_data, _err, params) => {
      if (!params.dry_run) {
        qc.invalidateQueries({ queryKey: ["entries"] });
        qc.invalidateQueries({ queryKey: ["rewinds"] });
        qc.invalidateQueries({ queryKey: ["graph"] });
      }
    },
  });
}
