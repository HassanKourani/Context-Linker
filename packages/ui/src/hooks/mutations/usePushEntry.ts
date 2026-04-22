import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushEntry } from "@/lib/api";
import { toast } from "sonner";

export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId, ...body }: { bundleId: string; project_name: string; event_type: string; summary: string; mode?: string }) =>
      pushEntry(bundleId, body),
    onSuccess: () => {
      toast.success("Entry pushed");
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
