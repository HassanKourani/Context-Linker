import { useMutation, useQueryClient } from "@tanstack/react-query";
import { joinBundle } from "@/lib/api";
import { toast } from "sonner";

export function useJoinBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundleId, project_name, mode }: { bundleId: string; project_name: string; mode: "local" | "cloud" }) =>
      joinBundle(bundleId, { project_name, mode }),
    onSuccess: (data) => {
      toast.success(`Linked to "${data.name}"`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
