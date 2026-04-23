import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unlinkSession } from "@/lib/api";
import { toast } from "sonner";

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      session_id: string;
      bundle_id: string;
      project_name: string;
      mode: "local" | "cloud";
    }) => unlinkSession(params),
    onSuccess: () => {
      toast.success("Session unlinked");
      qc.invalidateQueries({ queryKey: ["graph"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
