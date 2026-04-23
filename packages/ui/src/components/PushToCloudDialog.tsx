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

export function PushToCloudDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const pushToCloudTarget = useUIStore((s) => s.pushToCloudTarget);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "push-to-cloud" && !!pushToCloudTarget;

  const [selectedTeamId, setSelectedTeamId] = useState("");
  const { data: teams } = useTeams();
  const mutation = useCopyToCloud();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushToCloudTarget || !selectedTeamId) return;
    mutation.mutate(
      { sessionId: pushToCloudTarget, teamId: selectedTeamId },
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
            Create an independent copy of this session in the cloud. The local session stays as-is
            — changes to either version won't affect the other.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Team</label>
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
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !selectedTeamId}>
              {mutation.isPending ? "Copying..." : "Copy to Cloud"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
