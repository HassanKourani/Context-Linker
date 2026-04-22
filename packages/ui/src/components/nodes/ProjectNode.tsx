import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "../../lib/time";

interface SessionData {
  id: string;
  machineId: string;
  lastActiveAt: string | null;
  isYou: boolean;
}

export function ProjectNode({ data }: NodeProps) {
  const { projectName, sessions } = data as {
    projectName: string;
    sessions: SessionData[];
  };

  return (
    <div className="bg-[#1e1e2e] border border-[#313244] rounded-lg min-w-[200px] shadow-lg">
      <div className="px-3 py-2 border-b border-[#313244] font-semibold text-sm text-[#cdd6f4]">
        {projectName}
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="px-3 py-1.5 flex items-center gap-2 text-xs text-[#a6adc8] relative"
        >
          <span className="font-mono text-[11px]">
            {s.machineId.slice(0, 8)}
          </span>
          {s.isYou && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1]">
              You
            </span>
          )}
          <span className="ml-auto text-[#585b70] text-[10px]">
            {relativeTime(s.lastActiveAt)}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={s.id}
            className="!w-2 !h-2 !bg-[#585b70] !border-[#313244]"
          />
        </div>
      ))}
    </div>
  );
}
