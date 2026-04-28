import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EventTypeBadge } from "./EventTypeBadge";
import { relativeTime } from "@/lib/time";
import { teamColor } from "@/lib/colors";
import { useUIStore } from "@/stores/uiStore";
import type { EntryRow } from "@/types";

const ROLE_STYLES: Record<string, string> = {
  ticket:     "bg-blue-500/15 text-blue-300 border-blue-500/40",
  constraint: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  design:     "bg-violet-500/15 text-violet-300 border-violet-500/40",
  decision:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  bug:        "bg-red-500/15 text-red-300 border-red-500/40",
  qa:         "bg-pink-500/15 text-pink-300 border-pink-500/40",
  note:       "bg-muted text-muted-foreground border-border",
};

function RolePill({ role }: { role?: string | null }) {
  if (!role) return null;
  const cls = ROLE_STYLES[role] ?? ROLE_STYLES.note;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {role}
    </span>
  );
}

export function EntryCard({ entry, bundleRefCount }: { entry: EntryRow; bundleRefCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const selectedEntryIds = useUIStore((s) => s.selectedEntryIds);
  const toggleEntry = useUIStore((s) => s.toggleEntry);
  const isSelected = selectedEntryIds.has(entry.id);

  const projectColor = teamColor(entry.project_name ?? "unknown");

  return (
    <div className={`border-b border-border p-3 ${isSelected ? "bg-primary/5" : ""}`}>
      <div className="flex items-start gap-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleEntry(entry.id)}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {entry.project_name ? (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: `${projectColor}20`, color: projectColor }}
              >
                {entry.project_name}
              </span>
            ) : null}
            <RolePill role={entry.role} />
            <EventTypeBadge type={entry.event_type} />
            {entry.trigger_ref && (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {entry.trigger_ref.slice(0, 8)}
              </span>
            )}
            {bundleRefCount != null && bundleRefCount > 0 && (
              <span className="text-xs text-mauve bg-surface0 px-1.5 py-0.5 rounded">
                in {bundleRefCount} bundle{bundleRefCount !== 1 ? "s" : ""}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/60" title={entry.created_at}>
              {relativeTime(entry.created_at)}
            </span>
          </div>
          <p className="text-xs text-foreground leading-relaxed">
            {expanded ? entry.summary : entry.summary.slice(0, 200)}
            {!expanded && entry.summary.length > 200 && (
              <button
                onClick={() => setExpanded(true)}
                className="text-primary ml-1 hover:underline"
              >
                more
              </button>
            )}
          </p>
          {entry.files_touched.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {entry.files_touched.length} files
            </button>
          )}
          {expanded && entry.files_touched.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {entry.files_touched.map((f) => (
                <div key={f} className="font-mono text-[10px] text-muted-foreground/80 pl-4">
                  {f}
                </div>
              ))}
            </div>
          )}
          {expanded && entry.decisions.length > 0 && (
            <div className="mt-2 space-y-1">
              {entry.decisions.map((d, i) => (
                <div key={i} className="text-[11px] text-muted-foreground pl-4 border-l-2 border-primary/30">
                  <span className="text-foreground">{d.decision}</span>
                  {d.affects.length > 0 && (
                    <span className="text-muted-foreground/60 ml-1">
                      [{d.affects.join(", ")}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
