import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, X } from "lucide-react";
import { relativeTime } from "@/lib/time";
import { useUIStore } from "@/stores/uiStore";
import { useDeleteActiveSession } from "@/hooks/mutations/useDeleteActiveSession";

interface SessionData {
  id: string;
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
}

export function ProjectNode({ data }: NodeProps) {
  const { projectName, sessions } = data as {
    projectName: string;
    sessions: SessionData[];
  };

  const openBundlePanel = useUIStore((s) => s.openBundlePanel);
  const openSessionPanel = useUIStore((s) => s.openSessionPanel);
  const openModal = useUIStore((s) => s.openModal);
  const setPushToCloudTarget = useUIStore((s) => s.setPushToCloudTarget);
  const deleteMutation = useDeleteActiveSession();

  const handleSessionClick = (s: SessionData) => {
    if (s.bundleId) {
      openBundlePanel(s.bundleId, projectName);
    } else {
      openSessionPanel(s.id, projectName);
    }
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteMutation.mutate(sessionId);
  };

  return (
    <div className="bg-card border border-border rounded-lg min-w-[200px] shadow-lg">
      <div className="px-3 py-2 border-b border-border font-semibold text-sm text-foreground">
        {projectName}
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="group px-3 py-1.5 flex items-center gap-2 text-xs text-muted-foreground relative cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleSessionClick(s)}
        >
          <span className="font-mono text-[11px] truncate max-w-[100px]" title={s.id}>
            {s.branch ?? s.id.slice(0, 8)}
            {s.branchTotal > 1 && ` (#${s.branchSeq})`}
          </span>
          {s.isYou && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1]">
              You
            </span>
          )}
          {s.cloudSessionId ? (
            <span title="Synced to cloud"><Cloud className="w-3 h-3 text-[#89b4fa]" /></span>
          ) : s.isYou ? (
            <button
              className="px-1 py-0.5 rounded text-[9px] font-medium bg-[#89b4fa]/15 text-[#89b4fa] hover:bg-[#89b4fa]/25 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setPushToCloudTarget(s.id);
                openModal("push-to-cloud");
              }}
              title="Push session to cloud"
            >
              ↑ Cloud
            </button>
          ) : null}
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
            className="!w-2.5 !h-2.5 !bg-[#585b70] !border-border hover:!bg-[#a6e3a1] !cursor-grab !transition-colors"
          />
        </div>
      ))}
    </div>
  );
}
