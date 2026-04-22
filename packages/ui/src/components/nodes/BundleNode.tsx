import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "../../lib/time";

export function BundleNode({ data }: NodeProps) {
  const { bundleName, entryCount, lastEntryAt } = data as {
    bundleName: string;
    entryCount: number;
    lastEntryAt: string | null;
  };

  return (
    <div className="bg-[#1e1e2e] border border-[#313244] rounded-lg min-w-[180px] shadow-lg">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#585b70] !border-[#313244]"
      />
      <div className="px-3 py-2 border-b border-[#313244] font-semibold text-sm text-[#cdd6f4]">
        {bundleName}
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="text-xs text-[#a6adc8]">
          <span className="text-[#cdd6f4] font-medium">{entryCount}</span>{" "}
          entries
        </div>
        <div className="text-[10px] text-[#585b70]">
          {relativeTime(lastEntryAt)}
        </div>
      </div>
    </div>
  );
}
