import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useUIStore } from "@/stores/uiStore";
import { useGraphData } from "@/hooks/useGraphData";
import { useSessionEntries } from "@/hooks/useSessionEntries";
import { usePushSessionToBundle } from "@/hooks/mutations/usePushSessionToBundle";
import { useConnectSession } from "@/hooks/mutations/useConnectSession";
import { EventTypeBadge } from "./EventTypeBadge";
import { relativeTime } from "@/lib/time";
import { teamColor } from "@/lib/colors";

export function ConnectSessionDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const pendingConnectPush = useUIStore((s) => s.pendingConnectPush);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "connect-and-push" && !!pendingConnectPush;

  const sessionId = pendingConnectPush?.sessionId ?? null;
  const bundleId = pendingConnectPush?.bundleId ?? null;

  const { data: graphData } = useGraphData();
  const { data: entries, isLoading } = useSessionEntries(sessionId);
  const pushMutation = usePushSessionToBundle();
  const connectMutation = useConnectSession();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection when dialog opens with new data
  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id).join(","), [entries]);
  const [lastEntryIds, setLastEntryIds] = useState("");
  if (entryIds !== lastEntryIds) {
    setLastEntryIds(entryIds);
    if (entryIds) {
      // Auto-select all entries
      setSelected(new Set((entries ?? []).map((e) => e.id)));
    } else {
      setSelected(new Set());
    }
  }

  // Resolve bundle name
  let bundleName = "Bundle";
  if (graphData && bundleId) {
    for (const team of graphData.teams) {
      const b = team.bundles.find((b) => b.bundle_id === bundleId);
      if (b) { bundleName = b.bundle_name; break; }
    }
    const lb = graphData.local.bundles.find((b) => b.bundle_id === bundleId);
    if (lb) bundleName = lb.bundle_name;
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!entries) return;
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const handleSubmit = () => {
    if (!sessionId || !bundleId) return;
    const onSuccess = () => {
      closeModal();
      setSelected(new Set());
    };

    if (selected.size === 0) {
      // Connect only — no entries to push
      connectMutation.mutate(
        { sessionId, bundle_id: bundleId },
        { onSuccess }
      );
    } else {
      pushMutation.mutate(
        { sessionId, bundle_id: bundleId, entry_ids: [...selected] },
        { onSuccess }
      );
    }
  };

  const handleClose = () => {
    closeModal();
    setSelected(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Connect to {bundleName}</DialogTitle>
          <DialogDescription>
            Select entries to push, or connect without entries to consume context.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading entries...
          </div>
        )}

        {!isLoading && (!entries || entries.length === 0) && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            This session has no entries. You can still connect it to consume context from the bundle.
          </div>
        )}

        {!isLoading && entries && entries.length > 0 && (
          <>
            <div className="flex items-center justify-between px-1">
              <button
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {selected.size === entries.length ? "Deselect all" : "Select all"}
              </button>
              <span className="text-xs text-muted-foreground">
                {selected.size} of {entries.length} selected
              </span>
            </div>
            <div className="flex-1 overflow-y-auto border border-border rounded-md divide-y divide-border min-h-0">
              {entries.map((entry) => {
                const isSelected = selected.has(entry.id);
                const projectColor = teamColor(entry.project_name ?? "unknown");
                return (
                  <label
                    key={entry.id}
                    className={`flex items-start gap-2 p-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(entry.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{ backgroundColor: `${projectColor}20`, color: projectColor }}
                        >
                          {entry.project_name ?? "unknown"}
                        </span>
                        <EventTypeBadge type={entry.event_type} />
                        <span className="ml-auto text-[10px] text-muted-foreground/60">
                          {relativeTime(entry.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed line-clamp-2">
                        {entry.summary}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pushMutation.isPending || connectMutation.isPending}
          >
            {pushMutation.isPending || connectMutation.isPending
              ? "Connecting..."
              : selected.size === 0
                ? "Connect"
                : `Connect & Push ${selected.size} ${selected.size === 1 ? "Entry" : "Entries"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
