import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "@/lib/time";
import { useUIStore } from "@/stores/uiStore";

interface SessionData {
  id: string;
  machineId: string;
  lastActiveAt: string | null;
  isYou: boolean;
  bundleId: string | null;
  mode: "local" | "cloud";
}

export function ProjectNode({ data }: NodeProps) {
  const { projectName, sessions } = data as {
    projectName: string;
    sessions: SessionData[];
  };

  const openBundlePanel = useUIStore((s) => s.openBundlePanel);
  const openSessionPanel = useUIStore((s) => s.openSessionPanel);

  const handleSessionClick = (s: SessionData) => {
    if (s.bundleId) {
      // Connected session — show bundle entries filtered by this project
      openBundlePanel(s.bundleId, s.mode, projectName);
    } else {
      // Unlinked session — show session-level context
      openSessionPanel(s.id, projectName);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg min-w-[200px] shadow-lg">
      <div className="px-3 py-2 border-b border-border font-semibold text-sm text-foreground">
        {projectName}
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="px-3 py-1.5 flex items-center gap-2 text-xs text-muted-foreground relative cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleSessionClick(s)}
        >
          <span className="font-mono text-[11px]" title={s.id}>
            {s.id.slice(0, 8)}
          </span>
          {s.isYou && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1]">
              You
            </span>
          )}
          <span className="ml-auto text-muted-foreground/60 text-[10px]">
            {relativeTime(s.lastActiveAt)}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={s.id}
            isConnectable={true}
            className="!w-2.5 !h-2.5 !bg-[#585b70] !border-border hover:!bg-[#a6e3a1] !cursor-grab !transition-colors"
          />
        </div>
      ))}
    </div>
  );
}
