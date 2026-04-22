import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteBundle } from "@/lib/api";
import { toast } from "sonner";

export function useDeleteBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "local" | "cloud" }) =>
      deleteBundle(id, mode),
    onSuccess: () => {
      toast.success("Bundle deleted");
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
