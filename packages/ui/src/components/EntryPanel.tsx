import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RefreshCw, Undo2, X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useEntries } from "@/hooks/useEntries";
import { useGraphData } from "@/hooks/useGraphData";
import { EntryCard } from "./EntryCard";
import { RewindHistoryTab } from "./RewindHistoryTab";

export function EntryPanel() {
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const selectedBundleMode = useUIStore((s) => s.selectedBundleMode);
  const closePanel = useUIStore((s) => s.closePanel);
  const selectedEntryIds = useUIStore((s) => s.selectedEntryIds);
  const openModal = useUIStore((s) => s.openModal);
  const panelTab = useUIStore((s) => s.panelTab);
  const setPanelTab = useUIStore((s) => s.setPanelTab);
  const filterProject = useUIStore((s) => s.filterProject);
  const setFilterProject = useUIStore((s) => s.setFilterProject);
  const open = !!selectedBundleId;

  const { data: allEntries, isLoading, refetch } = useEntries(selectedBundleId, selectedBundleMode);
  const { data: graphData } = useGraphData();

  // Filter entries by project if filter is active
  const entries = useMemo(() => {
    if (!allEntries) return undefined;
    if (!filterProject) return allEntries;
    return allEntries.filter((e) => e.project_name === filterProject);
  }, [allEntries, filterProject]);

  // Find bundle name from graph data
  let bundleName = selectedBundleId ?? "";
  if (graphData) {
    for (const team of graphData.teams) {
      const b = team.bundles.find((b) => b.bundle_id === selectedBundleId);
      if (b) { bundleName = b.bundle_name; break; }
    }
    const lb = graphData.local.bundles.find((b) => b.bundle_id === selectedBundleId);
    if (lb) bundleName = lb.bundle_name;
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closePanel()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{bundleName}</SheetTitle>
          <SheetDescription>
            {entries?.length ?? 0} entries
            {filterProject && ` from ${filterProject}`}
          </SheetDescription>
        </SheetHeader>

        {filterProject && (
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
          <div className="ml-auto flex items-center gap-1">
            {selectedEntryIds.size > 0 && (
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
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => openModal("push-entry")}
            >
              Push
            </Button>
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
          {panelTab === "entries" && (
            <>
              {isLoading && (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              )}
              {!isLoading && entries?.length === 0 && (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {filterProject
                    ? `No entries from ${filterProject} in this bundle.`
                    : "No entries yet. Push context from a project."}
                </div>
              )}
              {entries?.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </>
          )}
          {panelTab === "rewinds" && <RewindHistoryTab />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
