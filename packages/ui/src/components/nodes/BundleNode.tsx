import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, CloudUpload, MoreHorizontal, Package, Trash2 } from "lucide-react";
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
  const setHoveredBundle = useUIStore((s) => s.setHoveredBundle);

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
      className="group relative rounded-[10px] min-w-[200px] cursor-pointer transition-[transform,box-shadow,outline-color] duration-200 ease-out outline outline-1 outline-white/[0.06] hover:outline-[#cba6f7]/35 hover:-translate-y-px"
      style={{
        background: "linear-gradient(180deg, #25253a 0%, #1c1c29 60%, #191926 100%)",
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.5), 0 12px 28px -16px rgba(0,0,0,0.6)",
      }}
      onClick={handleClick}
      onMouseEnter={() => setHoveredBundle(bundleId)}
      onMouseLeave={() => setHoveredBundle(null)}
    >
      {/* Refined accent: hairline gradient line + soft glow above */}
      <div
        className="pointer-events-none absolute inset-x-3 top-0 h-px opacity-70 group-hover:opacity-100 transition-opacity"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(203,166,247,0.55) 50%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-6 -top-[3px] h-[6px] rounded-full opacity-40 group-hover:opacity-80 transition-opacity blur-md"
        style={{ background: "rgba(203,166,247,0.55)" }}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#585b70] !border-border"
      />

      <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Package className="w-3.5 h-3.5 text-[#cba6f7] shrink-0" strokeWidth={1.75} />
          {!isLocal && <Cloud className="w-3 h-3 text-[#89b4fa]/70 shrink-0" strokeWidth={1.75} />}
          <span className="font-medium text-[13px] text-foreground/95 tracking-tight truncate">
            {bundleName}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan p-0.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px]">
            {isLocal && (
              <DropdownMenuItem className="cursor-pointer" onClick={handlePushToCloud}>
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

      {/* Hairline divider with fade */}
      <div
        className="mx-3.5 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.06) 80%, transparent 100%)",
        }}
      />

      <div className="px-3.5 py-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-medium text-foreground/95 tabular-nums tracking-tight">
            {entryCount}
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/60">
            {entryCount === 1 ? "entry" : "entries"}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/55 tabular-nums">
          {relativeTime(lastEntryAt)}
        </div>
      </div>
    </div>
  );
}
