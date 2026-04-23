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
import { useCopyToCloud } from "@/hooks/mutations/usePushToCloud";

/**
 * Shown when a user tries to connect a local session to a cloud bundle.
 * Copies the session to cloud and adds its entries to the bundle in one step.
 */
export function PushToCloudPromptDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const pendingCloudConnect = useUIStore((s) => s.pendingCloudConnect);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "push-to-cloud-prompt" && !!pendingCloudConnect;

  const [selectedTeamId, setSelectedTeamId] = useState("");
  const { data: teams } = useTeams();
  const copyMutation = useCopyToCloud();

  const handleCopyAndConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingCloudConnect || !selectedTeamId) return;

    // Copy session to cloud AND add entries to the bundle in one API call
    copyMutation.mutate(
      {
        sessionId: pendingCloudConnect.sessionId,
        teamId: selectedTeamId,
        bundleId: pendingCloudConnect.bundleId,
      },
      {
        onSuccess: () => {
          closeModal();
          setSelectedTeamId("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy Session to Cloud</DialogTitle>
          <DialogDescription>
            This session is local-only. To connect it to a cloud bundle, an independent
            copy will be created in the cloud. The local session stays unchanged —
            edits to either version won't affect the other.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCopyAndConnect} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Copy to team</label>
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
            <Button type="submit" disabled={copyMutation.isPending || !selectedTeamId}>
              {copyMutation.isPending ? "Copying..." : "Copy to Cloud & Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
