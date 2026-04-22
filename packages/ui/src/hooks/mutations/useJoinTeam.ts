import { useMutation, useQueryClient } from "@tanstack/react-query";
import { joinTeam } from "@/lib/api";
import { toast } from "sonner";

export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: joinTeam,
    onSuccess: (data) => {
      toast.success(`Joined team "${data.name}"`);
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
