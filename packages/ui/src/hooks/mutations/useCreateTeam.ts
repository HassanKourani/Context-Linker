import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTeam } from "@/lib/api";
import { toast } from "sonner";

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTeam,
    onSuccess: (data) => {
      toast.success(`Team "${data.name}" created`);
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
