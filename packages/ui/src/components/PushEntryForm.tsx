import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePushEntry } from "@/hooks/mutations/usePushEntry";
import { useUIStore } from "@/stores/uiStore";

const ROLE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "ticket",     label: "Ticket",      hint: "Goal/scope anchor — read first" },
  { value: "constraint", label: "Constraint",  hint: "Hard rules: don't do X, must use Y" },
  { value: "design",     label: "Design spec", hint: "UI/UX or behavior requirements" },
  { value: "decision",   label: "Decision",    hint: "Prior architectural decision (don't relitigate)" },
  { value: "bug",        label: "Bug",         hint: "Reported bug to investigate / fix" },
  { value: "qa",         label: "QA",          hint: "Failed QA run — reproduce + fix" },
  { value: "note",       label: "Note",        hint: "General context" },
];

export function PushEntryDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const open = activeModal === "push-entry" && !!selectedBundleId;

  const [role, setRole] = useState("note");
  const [summary, setSummary] = useState("");
  const mutation = usePushEntry();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBundleId) return;
    mutation.mutate(
      { bundleId: selectedBundleId, role, summary },
      {
        onSuccess: () => {
          closeModal();
          setRole("note");
          setSummary("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
          <DialogDescription>
            Tag the note with a role so agents read it with the right intent.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {ROLE_OPTIONS.find((r) => r.value === role)?.hint}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Summary</label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the ticket / constraint / bug / note..."
              required
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !summary}>
              {mutation.isPending ? "Adding..." : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
