import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { usePushEntry } from "@/hooks/mutations/usePushEntry";
import { useUIStore } from "@/stores/uiStore";
import { useGraphData } from "@/hooks/useGraphData";

export function PushEntryDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const open = activeModal === "push-entry" && !!selectedBundleId;

  const [projectName, setProjectName] = useState("");
  const [summary, setSummary] = useState("");
  const { data: graphData } = useGraphData();
  const mutation = usePushEntry();

  // Get available project names from the current bundle's sessions
  const projectNames: string[] = [];
  if (graphData && selectedBundleId) {
    for (const team of graphData.teams) {
      const bundle = team.bundles.find((b) => b.bundle_id === selectedBundleId);
      if (bundle) {
        for (const s of bundle.sessions) {
          if (!projectNames.includes(s.project_name)) projectNames.push(s.project_name);
        }
      }
    }
    const lb = graphData.local.bundles.find((b) => b.bundle_id === selectedBundleId);
    if (lb) {
      for (const p of lb.projects) {
        if (!projectNames.includes(p.project_name)) projectNames.push(p.project_name);
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBundleId) return;
    mutation.mutate(
      {
        bundleId: selectedBundleId,
        project_name: projectName,
        event_type: "manual",
        summary,
      },
      {
        onSuccess: () => {
          closeModal();
          setProjectName("");
          setSummary("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Push Entry</DialogTitle>
          <DialogDescription>Add a manual context note to this bundle.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Project</label>
            {projectNames.length > 0 ? (
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
              >
                <option value="">Select project...</option>
                {projectNames.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="project-name"
                required
              />
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Summary</label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe what changed or what context to share..."
              required
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !projectName || !summary}>
              {mutation.isPending ? "Pushing..." : "Push"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
