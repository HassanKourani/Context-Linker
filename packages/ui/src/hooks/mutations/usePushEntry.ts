import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EntryRow } from "@/types";

/**
 * Push a manual entry to a session (and optionally to a bundle via push-to-bundle).
 * NOTE: Direct push-to-bundle was removed when pushEntry was replaced by the
 * reference model (addEntriesToBundle). This hook is kept for potential future use
 * with session entry creation.
 */
export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bundleId,
      project_name,
      event_type,
      summary,
    }: {
      bundleId: string;
      project_name: string;
      event_type: string;
      summary: string;
    }) => {
      // POST to session entries is the new path; direct bundle push is removed
      throw new Error("Direct push to bundle is no longer supported. Use push-to-bundle from a session.");
    },

    onMutate: async ({ bundleId, project_name, event_type, summary }) => {
      const key = ["entries", bundleId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<EntryRow[]>(key);

      const optimistic: EntryRow = {
        id: `optimistic-${Date.now()}`,
        created_at: new Date().toISOString(),
        project_name,
        event_type,
        trigger_ref: null,
        summary,
        files_touched: [],
        decisions: [],
      };

      qc.setQueryData<EntryRow[]>(key, (old) =>
        old ? [optimistic, ...old] : [optimistic]
      );

      return { prev, key };
    },

    onError: (_err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(_err.message);
    },

    onSuccess: () => {
      toast.success("Entry pushed");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
