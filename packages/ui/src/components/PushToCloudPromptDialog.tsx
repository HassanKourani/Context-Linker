import { useState } from "react";
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
import { useTeams } from "@/hooks/useTeams";
import { usePushToCloud } from "@/hooks/mutations/usePushToCloud";
import { useConnectSession } from "@/hooks/mutations/useConnectSession";

/**
 * Shown when a user tries to connect a local session to a cloud bundle.
 * Explains that the session needs to be pushed to cloud first, offers to do it.
 */
export function PushToCloudPromptDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const pendingCloudConnect = useUIStore((s) => s.pendingCloudConnect);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "push-to-cloud-prompt" && !!pendingCloudConnect;

  const [selectedTeamId, setSelectedTeamId] = useState("");
  const { data: teams } = useTeams();
  const pushMutation = usePushToCloud();
  const connectMutation = useConnectSession();

  const handlePushAndConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingCloudConnect || !selectedTeamId) return;

    pushMutation.mutate(
      { sessionId: pendingCloudConnect.sessionId, teamId: selectedTeamId },
      {
        onSuccess: () => {
          // Now connect to the bundle
          connectMutation.mutate(
            {
              sessionId: pendingCloudConnect.sessionId,
              bundle_id: pendingCloudConnect.bundleId,
            },
            {
              onSuccess: () => {
                closeModal();
                setSelectedTeamId("");
              },
            },
          );
        },
      },
    );
  };

  const isPending = pushMutation.isPending || connectMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Not in Cloud</DialogTitle>
          <DialogDescription>
            This session is local-only. To connect it to a cloud bundle, it needs to be
            pushed to the cloud first. This will copy the session and its entries to the
            cloud under a team — the local session stays as-is.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handlePushAndConnect} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Push to team</label>
            {(teams ?? []).length > 0 ? (
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                required
              >
                <option value="">Select a team...</option>
                {(teams ?? []).map((t) => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No teams available. Create or join a team first.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !selectedTeamId}>
              {isPending ? "Pushing..." : "Push to Cloud & Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
