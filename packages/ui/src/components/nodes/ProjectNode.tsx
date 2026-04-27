import { useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FolderGit2, X } from "lucide-react";
import { relativeTime } from "@/lib/time";
import { useUIStore } from "@/stores/uiStore";
import { useDeleteActiveSession } from "@/hooks/mutations/useDeleteActiveSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";

interface SessionData {
  id: string;
  name: string | null;
  lastActiveAt: string | null;
  bundleId: string | null;
  mode: "local" | "cloud";
  branch: string | null;
  entryCount: number;
  branchSeq: number;
  branchTotal: number;
  cloudSessionId?: string | null;
  edgeColor: string;
}

function SessionLabel({ session }: { session: SessionData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const renameMutation = useRenameSession();

  const displayName = session.name
    || session.branch
    || session.id.slice(0, 8);
  const suffix = !session.name && session.branch && session.branchTotal > 1
    ? ` (#${session.branchSeq})`
    : "";

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const newName = trimmed || null;
    // Only save if actually changed
    if (newName !== (session.name || null)) {
      renameMutation.mutate({ sessionId: session.id, name: newName });
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="font-mono text-[11px] bg-transparent border border-border rounded px-1 py-0 outline-none focus:border-[#a6e3a1] max-w-[100px] text-foreground"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="font-mono text-[11px] truncate max-w-[100px] cursor-text hover:text-foreground transition-colors"
      title={`${session.name ? `${session.name} — ` : ""}${session.id}\nClick to rename`}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(session.name ?? "");
        setEditing(true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {displayName}{suffix}
    </span>
  );
}

export function ProjectNode({ data }: NodeProps) {
  const { projectName, sessions } = data as {
    projectName: string;
    sessions: SessionData[];
  };

  const openBundlePanel = useUIStore((s) => s.openBundlePanel);
  const openSessionPanel = useUIStore((s) => s.openSessionPanel);
  const setHoveredSession = useUIStore((s) => s.setHoveredSession);
  const highlightedSessionIds = useUIStore((s) => s.highlightedSessionIds);
  const deleteMutation = useDeleteActiveSession();

  const handleSessionClick = (s: SessionData) => {
    if (s.bundleId) {
      openBundlePanel(s.bundleId, projectName);
    } else {
      openSessionPanel(s.id, projectName, s.name);
    }
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteMutation.mutate(sessionId);
  };

  return (
    <div
      className="relative rounded-[10px] min-w-[220px] outline outline-1 outline-white/[0.06] overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #25253a 0%, #1c1c29 60%, #191926 100%)",
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.5), 0 12px 28px -16px rgba(0,0,0,0.6)",
      }}
    >
      {/* Left accent: vertical hairline + soft glow */}
      <div
        className="pointer-events-none absolute inset-y-3 left-0 w-px opacity-70"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(148,226,213,0.55) 50%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-6 -left-[3px] w-[6px] rounded-full opacity-30 blur-md"
        style={{ background: "rgba(148,226,213,0.55)" }}
      />

      <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-2">
        <FolderGit2 className="w-3.5 h-3.5 text-[#94e2d5] shrink-0" strokeWidth={1.75} />
        <span className="font-medium text-[13px] text-foreground/95 tracking-tight truncate">
          {projectName}
        </span>
      </div>

      {/* Hairline divider with fade */}
      <div
        className="mx-3.5 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.06) 80%, transparent 100%)",
        }}
      />

      <div className="py-1">
        {sessions.map((s) => {
          const isHighlighted = highlightedSessionIds.has(s.id);
          return (
          <div
            key={s.id}
            className={`group px-3.5 py-1.5 flex items-center gap-2 text-xs relative cursor-pointer transition-colors ${
              isHighlighted
                ? "bg-white/[0.04] text-foreground"
                : "text-muted-foreground hover:bg-white/[0.025]"
            }`}
            onClick={() => handleSessionClick(s)}
            onMouseEnter={() => setHoveredSession(s.id)}
            onMouseLeave={() => setHoveredSession(null)}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 ring-2 ring-[#25253a] transition-shadow"
              style={{
                background: s.edgeColor,
                boxShadow: isHighlighted
                  ? `0 0 10px ${s.edgeColor}, 0 0 4px ${s.edgeColor}`
                  : `0 0 6px ${s.edgeColor}80`,
              }}
            />
            <SessionLabel session={s} />
            <span className="ml-auto text-muted-foreground/55 text-[10px] whitespace-nowrap tabular-nums">
              {s.entryCount > 0
                ? `${s.entryCount} entr${s.entryCount === 1 ? "y" : "ies"}`
                : relativeTime(s.lastActiveAt)}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              onClick={(e) => handleDelete(e, s.id)}
              title="Delete session"
            >
              <X className="w-3 h-3" />
            </button>
            <Handle
              type="source"
              position={Position.Right}
              id={s.id}
              isConnectable={true}
              className="!w-2.5 !h-2.5 !border-[#1c1c29] !cursor-grab"
              style={{ background: s.edgeColor }}
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}
