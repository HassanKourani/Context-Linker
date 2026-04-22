import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBundle } from "@/lib/api";
import { toast } from "sonner";

export function useCreateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBundle,
    onSuccess: (data) => {
      toast.success(`Bundle "${data.name}" created`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
