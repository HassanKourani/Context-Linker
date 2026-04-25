import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
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

function FeedEventCard({ event, onNavigate }: { event: FeedEvent; onNavigate?: (bundleId: string) => void }) {
  const payload = event.payload;
  const time = new Date(event.created_at).toLocaleTimeString();
  const bundleId = (payload.bundle_id as string) ?? null;

  let description = "";
  switch (event.event_type) {
    case "entry_pushed":
      description = `${payload.entry_count ?? 0} entries → "${payload.bundle_name ?? payload.bundle_id}"`;
      if (payload.project_name) description = `${payload.project_name}: ${description}`;
      break;
    case "session_connected":
      description = `${payload.project_name ?? "Unknown"} connected to "${payload.bundle_name ?? payload.bundle_id}"`;
      break;
    case "session_disconnected":
      description = `${payload.project_name ?? "Unknown"} disconnected from "${payload.bundle_name ?? payload.bundle_id}"`;
      break;
    case "bundle_created":
      description = `"${payload.bundle_name ?? payload.bundle_id}" created`;
      break;
    case "bundle_deleted":
      description = `Bundle deleted`;
      break;
  }

  return (
    <div
      className={`flex items-start gap-3 py-2 px-1 ${bundleId ? "cursor-pointer hover:bg-card/50 rounded" : ""}`}
      onClick={() => bundleId && onNavigate?.(bundleId)}
    >
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${EVENT_COLORS[event.event_type] ?? "bg-muted"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {EVENT_LABELS[event.event_type] ?? event.event_type}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">{time}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
      </div>
    </div>
  );
}

export function FeedPanel() {
  const panel = useUIStore((s) => s.panel);
  const closePanel = useUIStore((s) => s.closePanel);
  const openBundlePanel = useUIStore((s) => s.openBundlePanel);
  const isFeed = panel?.kind === "feed";
  const teamId = isFeed ? panel.teamId : null;
  const teamName = isFeed ? panel.teamName : "";

  const { data: events, isLoading, refetch } = useFeed(teamId);

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
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm">Activity — {teamName}</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <SheetDescription className="text-xs">
            Recent activity from sessions connected to cloud bundles in this team.
          </SheetDescription>
        </SheetHeader>

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
