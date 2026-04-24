import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveQuestionApi } from "@/lib/api";
import { toast } from "sonner";

export function useResolveQuestion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ bundleId, questionId }: { bundleId: string; questionId: string }) =>
      resolveQuestionApi(bundleId, questionId),
    onSuccess: (_data, { bundleId }) => {
      qc.invalidateQueries({ queryKey: ["questions", bundleId] });
      qc.invalidateQueries({ queryKey: ["graph"] });
      toast.success("Question resolved");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
