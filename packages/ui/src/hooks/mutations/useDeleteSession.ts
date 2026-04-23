import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSession } from "@/lib/api";
import { toast } from "sonner";

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
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
