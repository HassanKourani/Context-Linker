import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useGraphData } from "@/hooks/useGraphData";
import { usePushSessionToBundle } from "@/hooks/mutations/usePushSessionToBundle";

export function PushSessionToBundleDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const panel = useUIStore((s) => s.panel);
  const closeModal = useUIStore((s) => s.closeModal);
  const selectedEntryIds = useUIStore((s) => s.selectedEntryIds);
  const clearEntrySelection = useUIStore((s) => s.clearEntrySelection);
  const open = activeModal === "push-session" && panel?.kind === "session";

  const sessionId = panel?.kind === "session" ? panel.sessionId : null;
  const [selectedBundleId, setSelectedBundleId] = useState("");
  const { data: graphData } = useGraphData();
  const mutation = usePushSessionToBundle();

  const hasSelection = selectedEntryIds.size > 0;

  // Only show bundles the session is connected to
  const connectedBundleIds = new Set<string>();
  if (graphData && sessionId) {
    const session = graphData.sessions?.find((s) => s.session_id === sessionId);
    if (session) {
      for (const b of session.bundles) connectedBundleIds.add(b.bundle_id);
    }
  }

  const bundles: Array<{ id: string; name: string; group: string }> = [];
  if (graphData) {
    for (const team of graphData.teams) {
      for (const b of team.bundles) {
        if (connectedBundleIds.has(b.bundle_id)) {
          bundles.push({ id: b.bundle_id, name: b.bundle_name, group: team.team_name });
        }
      }
    }
    for (const b of graphData.local.bundles) {
      if (connectedBundleIds.has(b.bundle_id)) {
        bundles.push({ id: b.bundle_id, name: b.bundle_name, group: "Local" });
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !selectedBundleId) return;
    mutation.mutate(
      {
        sessionId,
        bundle_id: selectedBundleId,
        entry_ids: hasSelection ? [...selectedEntryIds] : undefined,
      },
      {
        onSuccess: () => {
          closeModal();
          setSelectedBundleId("");
          clearEntrySelection();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push to Bundle</DialogTitle>
          <DialogDescription>
            {hasSelection
              ? `Push ${selectedEntryIds.size} selected entries to a bundle. Duplicates will be skipped.`
              : "Push all session entries to a bundle. Duplicates will be skipped."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Bundle</label>
            {bundles.length > 0 ? (
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                value={selectedBundleId}
                onChange={(e) => setSelectedBundleId(e.target.value)}
                required
              >
                <option value="">Select bundle...</option>
                {bundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.group})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No bundles available. Create one first.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !selectedBundleId}>
              {mutation.isPending ? "Pushing..." : hasSelection ? `Push ${selectedEntryIds.size} Entries` : "Push All"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
