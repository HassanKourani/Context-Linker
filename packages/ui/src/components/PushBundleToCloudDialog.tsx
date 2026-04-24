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
import { usePushBundleToCloud } from "@/hooks/mutations/usePushBundleToCloud";

export function PushBundleToCloudDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const target = useUIStore((s) => s.pushBundleToCloudTarget);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "push-bundle-to-cloud" && !!target;

  const [selectedTeamId, setSelectedTeamId] = useState("");
  const { data: teams } = useTeams();
  const mutation = usePushBundleToCloud();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !selectedTeamId) return;
    mutation.mutate(
      { bundleId: target.id, teamId: selectedTeamId },
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
          <DialogTitle>Push Bundle to Cloud</DialogTitle>
          <DialogDescription>
            Push <strong>"{target?.name}"</strong> to the cloud. Connected sessions
            will be copied to the selected team and their entries migrated.
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
            <Button variant="outline" onClick={closeModal} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !selectedTeamId}>
              {mutation.isPending ? "Pushing..." : "Push to Cloud"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
