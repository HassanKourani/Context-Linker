import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RefreshCw, Undo2, X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useEntries } from "@/hooks/useEntries";
import { useSessionEntries } from "@/hooks/useSessionEntries";
import { useGraphData } from "@/hooks/useGraphData";
import { EntryCard } from "./EntryCard";
import { RewindHistoryTab } from "./RewindHistoryTab";

export function EntryPanel() {
  const panel = useUIStore((s) => s.panel);
  const closePanel = useUIStore((s) => s.closePanel);
  const selectedEntryIds = useUIStore((s) => s.selectedEntryIds);
  const openModal = useUIStore((s) => s.openModal);
  const panelTab = useUIStore((s) => s.panelTab);
  const setPanelTab = useUIStore((s) => s.setPanelTab);
  const setFilterProject = useUIStore((s) => s.setFilterProject);
  const open = !!panel;

  const isBundle = panel?.kind === "bundle";
  const isSession = panel?.kind === "session";
  const bundleId = isBundle ? panel.bundleId : null;
  const bundleMode = isBundle ? panel.mode : "cloud";
  const filterProject = isBundle ? panel.filterProject : null;
  const sessionId = isSession ? panel.sessionId : null;

  const { data: bundleEntries, isLoading: bundleLoading, refetch: refetchBundle } = useEntries(bundleId, bundleMode);
  const { data: sessionEntries, isLoading: sessionLoading, refetch: refetchSession } = useSessionEntries(sessionId);
  const { data: graphData } = useGraphData();

  const isLoading = isBundle ? bundleLoading : sessionLoading;
  const refetch = isBundle ? refetchBundle : refetchSession;

  // Filter bundle entries by project if filter is active
  const entries = useMemo(() => {
    if (isSession) return sessionEntries ?? [];
    if (!bundleEntries) return [];
    if (!filterProject) return bundleEntries;
    return bundleEntries.filter((e) => e.project_name === filterProject);
  }, [isBundle, isSession, bundleEntries, sessionEntries, filterProject]);

  // Resolve panel title
  let panelTitle = "";
  let panelSubtitle = "";

  if (isBundle && graphData) {
    for (const team of graphData.teams) {
      const b = team.bundles.find((b) => b.bundle_id === bundleId);
      if (b) { panelTitle = b.bundle_name; break; }
    }
    const lb = graphData.local.bundles.find((b) => b.bundle_id === bundleId);
    if (lb) panelTitle = lb.bundle_name;
    panelSubtitle = `${entries.length} entries${filterProject ? ` from ${filterProject}` : ""}`;
  } else if (isSession) {
    panelTitle = panel.projectName;
    panelSubtitle = `Session context — ${entries.length} entries`;
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closePanel()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{panelTitle}</SheetTitle>
          <SheetDescription>{panelSubtitle}</SheetDescription>
        </SheetHeader>

        {isBundle && filterProject && (
          <div className="mx-4 px-3 py-1.5 rounded bg-primary/10 border border-primary/20 flex items-center justify-between">
            <span className="text-xs text-primary">
              Filtered: <strong>{filterProject}</strong>
            </span>
            <button
              onClick={() => setFilterProject(null)}
              className="text-primary hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-4">
          {isBundle && (
            <div className="flex gap-1">
              <Button
                variant={panelTab === "entries" ? "default" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setPanelTab("entries")}
              >
                Entries
              </Button>
              <Button
                variant={panelTab === "rewinds" ? "default" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setPanelTab("rewinds")}
              >
                Rewinds
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            {isBundle && selectedEntryIds.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-destructive"
                onClick={() => openModal("rewind")}
              >
                <Undo2 className="w-3 h-3 mr-1" />
                Rewind ({selectedEntryIds.size})
              </Button>
            )}
            {isBundle && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => openModal("push-entry")}
              >
                Push
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => refetch()}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {(isSession || panelTab === "entries") && (
            <>
              {isLoading && (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              )}
              {!isLoading && entries.length === 0 && (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {isSession
                    ? "No context yet for this session. Push entries or connect to a bundle."
                    : filterProject
                      ? `No entries from ${filterProject} in this bundle.`
                      : "No entries yet. Push context from a project."}
                </div>
              )}
              {entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </>
          )}
          {isBundle && panelTab === "rewinds" && <RewindHistoryTab />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
