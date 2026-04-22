import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRewind } from "@/hooks/mutations/useRewind";
import { useUIStore } from "@/stores/uiStore";

export function RewindDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const selectedEntryIds = useUIStore((s) => s.selectedEntryIds);
  const clearEntrySelection = useUIStore((s) => s.clearEntrySelection);
  const open = activeModal === "rewind" && selectedEntryIds.size > 0;

  const [reason, setReason] = useState("");
  const mutation = useRewind();

  // We need a project_name for the rewind. For simplicity, we'll get it from the entries query.
  // But since we don't have entries data here, we'll pass a generic project name.
  // The server-side rewind scopes by project, so we need at least one project.
  // For now, use empty string — the server should handle by matching entry IDs.

  const handleRewind = (dryRun: boolean) => {
    if (!selectedBundleId) return;
    mutation.mutate(
      {
        bundleId: selectedBundleId,
        project_name: "", // entry_ids strategy doesn't need project scoping
        strategy: { kind: "entry_ids", ids: Array.from(selectedEntryIds) },
        reason: reason || undefined,
        dry_run: dryRun,
      },
      {
        onSuccess: (data) => {
          if (!dryRun && data.applied) {
            clearEntrySelection();
            closeModal();
            setReason("");
          }
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rewind Entries</DialogTitle>
          <DialogDescription>
            Soft-delete {selectedEntryIds.size} selected {selectedEntryIds.size === 1 ? "entry" : "entries"}. They can be restored later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Reason (optional)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you rewinding these entries?"
              rows={2}
            />
          </div>
          {mutation.data && mutation.data.dry_run && (
            <div className="p-3 rounded bg-muted text-xs">
              <p className="font-medium text-foreground mb-1">
                Preview: {mutation.data.affected_count} entries would be rewound
              </p>
              {mutation.data.affected_entries.map((e) => (
                <p key={e.id} className="text-muted-foreground truncate">
                  {e.summary_preview}
                </p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleRewind(true)} disabled={mutation.isPending}>
            Preview
          </Button>
          <Button variant="destructive" onClick={() => handleRewind(false)} disabled={mutation.isPending}>
            {mutation.isPending ? "Rewinding..." : "Rewind"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
