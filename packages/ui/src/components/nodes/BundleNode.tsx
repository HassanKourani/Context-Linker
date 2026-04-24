import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, CloudUpload, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/time";
import { useUIStore } from "@/stores/uiStore";

export function BundleNode({ data }: NodeProps) {
  const { bundleId, bundleName, entryCount, lastEntryAt, mode } = data as {
    bundleId: string;
    bundleName: string;
    entryCount: number;
    lastEntryAt: string | null;
    mode: "local" | "cloud";
  };

  const openPanel = useUIStore((s) => s.openPanel);
  const setDeleteTarget = useUIStore((s) => s.setDeleteTarget);
  const setPushBundleToCloudTarget = useUIStore((s) => s.setPushBundleToCloudTarget);
  const openModal = useUIStore((s) => s.openModal);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openPanel(bundleId);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({ id: bundleId, name: bundleName });
    openModal("delete-bundle");
  };

  const handlePushToCloud = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPushBundleToCloudTarget({ id: bundleId, name: bundleName });
    openModal("push-bundle-to-cloud");
  };

  const isLocal = mode === "local";

  return (
    <div
      className="bg-card border border-border rounded-lg min-w-[180px] shadow-lg cursor-pointer hover:border-primary/50 transition-colors"
      onClick={handleClick}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#585b70] !border-border"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="questions"
        className="!w-2 !h-2 !bg-yellow/60 !border-border"
      />
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {!isLocal && <Cloud className="w-3 h-3 text-blue/60 shrink-0" />}
          <span className="font-semibold text-sm text-foreground truncate">
            {bundleName}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px]">
            {isLocal && (
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={handlePushToCloud}
              >
                <CloudUpload className="w-3.5 h-3.5 mr-2" />
                Push to Cloud
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive cursor-pointer"
              onClick={handleDelete}
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete bundle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{entryCount}</span>{" "}
          entries
        </div>
        <div className="text-[10px] text-muted-foreground/60">
          {relativeTime(lastEntryAt)}
        </div>
      </div>
    </div>
  );
}
