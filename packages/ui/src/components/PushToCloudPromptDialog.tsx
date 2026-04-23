import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useGraphData } from "@/hooks/useGraphData";
import { useCopyToCloud } from "@/hooks/mutations/usePushToCloud";

/**
 * Shown when a user tries to connect a local session to a cloud bundle.
 * Auto-detects the bundle's team — no team picker needed.
 */
export function PushToCloudPromptDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const pendingCloudConnect = useUIStore((s) => s.pendingCloudConnect);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "push-to-cloud-prompt" && !!pendingCloudConnect;

  const { data: graphData } = useGraphData();
  const copyMutation = useCopyToCloud();

  // Resolve the bundle's team from graph data
  let bundleTeamId: string | null = null;
  let bundleTeamName: string | null = null;
  if (graphData && pendingCloudConnect) {
    for (const team of graphData.teams) {
      if (team.bundles.some((b) => b.bundle_id === pendingCloudConnect.bundleId)) {
        bundleTeamId = team.team_id;
        bundleTeamName = team.team_name;
        break;
      }
    }
  }

  const handleCopyAndConnect = () => {
    if (!pendingCloudConnect || !bundleTeamId) return;

    copyMutation.mutate(
      {
        sessionId: pendingCloudConnect.sessionId,
        teamId: bundleTeamId,
        bundleId: pendingCloudConnect.bundleId,
      },
      { onSuccess: () => closeModal() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy Session to Cloud</DialogTitle>
          <DialogDescription>
            This session is local-only. To connect it to a cloud bundle, an independent
            copy will be created in <strong>{bundleTeamName ?? "the team"}</strong>.
            The local session stays unchanged — edits to either version won't affect the other.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
          <Button onClick={handleCopyAndConnect} disabled={copyMutation.isPending || !bundleTeamId}>
            {copyMutation.isPending ? "Copying..." : "Copy to Cloud & Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
