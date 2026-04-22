import { Button } from "@/components/ui/button";
import { useRewinds } from "@/hooks/useRewinds";
import { useRestore } from "@/hooks/mutations/useRestore";
import { useUIStore } from "@/stores/uiStore";
import { relativeTime } from "@/lib/time";

export function RewindHistoryTab() {
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const { data: rewinds, isLoading } = useRewinds(selectedBundleId);
  const restoreMutation = useRestore();

  const handleRestore = (rewindId: string, projectName: string) => {
    if (!selectedBundleId) return;
    restoreMutation.mutate({
      bundleId: selectedBundleId,
      project_name: projectName,
      rewind_log_id: rewindId,
    });
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>;
  }

  if (!rewinds || rewinds.length === 0) {
    return <div className="p-4 text-center text-muted-foreground text-sm">No rewinds yet.</div>;
  }

  return (
    <div className="divide-y divide-border">
      {rewinds.map((r) => (
        <div key={r.id} className="p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground font-medium">
              {r.affected_count} entries — {r.strategy_kind}
            </span>
            <span className="text-[10px] text-muted-foreground/60" title={r.performed_at}>
              {relativeTime(r.performed_at)}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {r.project_name}
            {r.reason && <span className="ml-2 italic">"{r.reason}"</span>}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs mt-1"
            onClick={() => handleRestore(r.id, r.project_name)}
            disabled={restoreMutation.isPending}
          >
            Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
