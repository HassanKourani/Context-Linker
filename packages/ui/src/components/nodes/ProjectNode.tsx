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
  machineId: string;
  lastActiveAt: string | null;
  isYou: boolean;
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
    <div className="bg-card border border-border rounded-lg min-w-[200px] shadow-lg" style={{ borderLeftWidth: 3, borderLeftColor: '#94e2d5' }}>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2" style={{ background: 'rgba(148, 226, 213, 0.06)' }}>
        <FolderGit2 className="w-3.5 h-3.5 text-[#94e2d5] shrink-0" />
        <span className="font-semibold text-sm text-foreground">{projectName}</span>
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="group px-3 py-1.5 flex items-center gap-2 text-xs text-muted-foreground relative cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleSessionClick(s)}
          onMouseEnter={() => setHoveredSession(s.id)}
          onMouseLeave={() => setHoveredSession(null)}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: s.edgeColor }}
          />
          <SessionLabel session={s} />
          {s.isYou && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1]">
              You
            </span>
          )}
          <span className="ml-auto text-muted-foreground/60 text-[10px] whitespace-nowrap">
            {s.entryCount > 0 ? `${s.entryCount} entr${s.entryCount === 1 ? "y" : "ies"}` : relativeTime(s.lastActiveAt)}
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
            className="!w-2.5 !h-2.5 !border-[#313244] !cursor-grab"
            style={{ background: s.edgeColor }}
          />
        </div>
      ))}
    </div>
  );
}
