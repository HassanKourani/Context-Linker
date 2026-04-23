import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removeEntryRefFromBundle } from "@/lib/api";
import { toast } from "sonner";

export function useRemoveBundleEntryRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId, entryId }: { bundleId: string; entryId: string }) =>
      removeEntryRefFromBundle(bundleId, entryId),

    onSuccess: () => {
      toast.success("Entry reference removed from bundle.");
    },

    onError: (err: Error) => {
      toast.error(err.message);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
