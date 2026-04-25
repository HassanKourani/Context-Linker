import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useGraphData } from "@/hooks/useGraphData";
import { useFeed } from "@/hooks/useFeed";
import type { FeedEvent } from "@/types";

const EVENT_LABELS: Record<string, string> = {
  entry_pushed: "Entries pushed",
  session_connected: "Session connected",
  session_disconnected: "Session disconnected",
  bundle_created: "Bundle created",
  bundle_deleted: "Bundle deleted",
};

const EVENT_COLORS: Record<string, string> = {
  entry_pushed: "bg-[#a6e3a1]",
  session_connected: "bg-[#89b4fa]",
  session_disconnected: "bg-[#f38ba8]",
  bundle_created: "bg-[#f9e2af]",
  bundle_deleted: "bg-[#f38ba8]",
};

function eventDescription(event: FeedEvent): string {
  const p = event.payload;
  switch (event.event_type) {
    case "entry_pushed": {
      const target = (p.bundle_name as string) ?? (p.bundle_id as string)?.slice(0, 8) ?? "bundle";
      const prefix = p.project_name ? `${p.project_name}: ` : "";
      return `${prefix}${p.entry_count ?? 0} entries → "${target}"`;
    }
    case "session_connected":
      return `${p.project_name ?? "Unknown"} connected to "${(p.bundle_name as string) ?? (p.bundle_id as string)?.slice(0, 8) ?? "bundle"}"`;
    case "session_disconnected":
      return `${p.project_name ?? "Unknown"} disconnected from "${(p.bundle_name as string) ?? (p.bundle_id as string)?.slice(0, 8) ?? "bundle"}"`;
    case "bundle_created":
      return `"${(p.bundle_name as string) ?? (p.bundle_id as string)?.slice(0, 8) ?? "bundle"}" created`;
    case "bundle_deleted":
      return `Bundle deleted`;
    default:
      return event.event_type;
  }
}

function FeedEventCard({ event, onNavigate }: { event: FeedEvent; onNavigate?: (bundleId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const payload = event.payload;
  const time = new Date(event.created_at).toLocaleTimeString();
  const bundleId = (payload.bundle_id as string) ?? null;

  const details = Object.entries(payload).filter(
    ([k]) => !["bundle_name"].includes(k),
  );

  return (
    <div className="py-2 px-1">
      <div
        className="flex items-start gap-3 cursor-pointer hover:bg-card/50 rounded px-1 py-0.5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${EVENT_COLORS[event.event_type] ?? "bg-muted"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground flex items-center gap-1">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {EVENT_LABELS[event.event_type] ?? event.event_type}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{time}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{eventDescription(event)}</p>
        </div>
      </div>

      {expanded && (
        <div className="ml-7 mt-1 space-y-1 text-xs">
          {details.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-muted-foreground/60 shrink-0">{key}:</span>
              <span
                className={`text-muted-foreground break-all ${key === "bundle_id" && bundleId ? "cursor-pointer hover:text-foreground underline" : ""}`}
                onClick={() => key === "bundle_id" && bundleId && onNavigate?.(bundleId)}
              >
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FeedPanel() {
  const panel = useUIStore((s) => s.panel);
  const closePanel = useUIStore((s) => s.closePanel);
  const openBundlePanel = useUIStore((s) => s.openBundlePanel);
  const isFeed = panel?.kind === "feed";

  const { data: graphData } = useGraphData();
  const teams = graphData?.teams ?? [];

  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const { data: events, isLoading, refetch } = useFeed(filterTeamId);

  const handleNavigate = (bundleId: string) => {
    openBundlePanel(bundleId);
  };

  // Group events by date
  const grouped = (events ?? []).reduce<Record<string, FeedEvent[]>>((acc, event) => {
    const date = new Date(event.created_at).toLocaleDateString();
    (acc[date] ??= []).push(event);
    return acc;
  }, {});

  return (
    <Sheet open={isFeed} onOpenChange={(o) => !o && closePanel()}>
      <SheetContent side="right" className="w-[420px] overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-sm">Live Feed</SheetTitle>
          <SheetDescription className="text-xs">
            Recent activity from sessions connected to cloud bundles.
          </SheetDescription>
        </SheetHeader>

        {/* Team filter + refresh */}
        <div className="flex items-center gap-2 pb-3">
          <select
            value={filterTeamId ?? ""}
            onChange={(e) => setFilterTeamId(e.target.value || null)}
            className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#89b4fa]"
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.team_name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-7 w-7 p-0 shrink-0"
            title="Refresh feed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {isLoading && !events && (
          <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
        )}

        {events && events.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No activity yet.</p>
        )}

        {Object.entries(grouped).map(([date, dayEvents]) => (
          <div key={date} className="mb-4">
            <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide mb-2 px-1">
              {date}
            </div>
            <div className="divide-y divide-border/50">
              {dayEvents.map((event) => (
                <FeedEventCard key={event.id} event={event} onNavigate={handleNavigate} />
              ))}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
