import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTeams } from "@/hooks/useTeams";
import { useCreateTeam } from "@/hooks/mutations/useCreateTeam";
import { useJoinTeam } from "@/hooks/mutations/useJoinTeam";
import { useUIStore } from "@/stores/uiStore";
import { relativeTime } from "@/lib/time";

export function TeamManagementDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "team-management";

  const [tab, setTab] = useState<"list" | "create" | "join">("list");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const { data: teams, isLoading } = useTeams();
  const createMutation = useCreateTeam();
  const joinMutation = useJoinTeam();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { name, join_code: joinCode },
      {
        onSuccess: () => {
          setTab("list");
          setName("");
          setJoinCode("");
        },
      }
    );
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    joinMutation.mutate(
      { name, join_code: joinCode },
      {
        onSuccess: () => {
          setTab("list");
          setName("");
          setJoinCode("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Teams</DialogTitle>
          <DialogDescription>Manage your team memberships.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 mb-2">
          <Button variant={tab === "list" ? "default" : "ghost"} size="sm" className="text-xs" onClick={() => setTab("list")}>
            My Teams
          </Button>
          <Button variant={tab === "create" ? "default" : "ghost"} size="sm" className="text-xs" onClick={() => setTab("create")}>
            Create
          </Button>
          <Button variant={tab === "join" ? "default" : "ghost"} size="sm" className="text-xs" onClick={() => setTab("join")}>
            Join
          </Button>
        </div>

        {tab === "list" && (
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {!isLoading && (!teams || teams.length === 0) && (
              <p className="text-sm text-muted-foreground">No teams yet. Create or join one.</p>
            )}
            {teams?.map((t) => (
              <div key={t.team_id} className="p-2 rounded bg-muted flex items-center justify-between">
                <span className="text-sm text-foreground font-medium">{t.name}</span>
                <span className="text-[10px] text-muted-foreground">{relativeTime(t.joined_at)}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "create" && (
          <form onSubmit={handleCreate} className="space-y-3">
            <Input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input type="password" placeholder="Join code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required />
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Team"}
            </Button>
          </form>
        )}

        {tab === "join" && (
          <form onSubmit={handleJoin} className="space-y-3">
            <Input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input type="password" placeholder="Join code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required />
            <Button type="submit" className="w-full" disabled={joinMutation.isPending}>
              {joinMutation.isPending ? "Joining..." : "Join Team"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
