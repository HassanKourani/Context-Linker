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
import { Input } from "@/components/ui/input";
import { useTeams } from "@/hooks/useTeams";
import { useCreateBundle } from "@/hooks/mutations/useCreateBundle";
import { useUIStore } from "@/stores/uiStore";

export function CreateBundleDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "create-bundle";

  const [name, setName] = useState("");
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [teamId, setTeamId] = useState("");
  const { data: teams } = useTeams();
  const mutation = useCreateBundle();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(
      { name, mode, team_id: mode === "cloud" ? teamId : undefined },
      {
        onSuccess: () => {
          closeModal();
          setName("");
          setMode("local");
          setTeamId("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Bundle</DialogTitle>
          <DialogDescription>
            Create a new context bundle to share across projects.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-feature"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Mode</label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "local" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("local")}
              >
                Local
              </Button>
              <Button
                type="button"
                variant={mode === "cloud" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("cloud")}
              >
                Cloud
              </Button>
            </div>
          </div>
          {mode === "cloud" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Team</label>
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                required
              >
                <option value="">Select a team...</option>
                {(teams ?? []).map((t) => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !name}>
              {mutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
