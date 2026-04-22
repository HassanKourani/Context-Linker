interface TopBarProps {
  machineId: string | undefined;
  isLoading: boolean;
  dataUpdatedAt: number;
}

export function TopBar({ machineId, isLoading, dataUpdatedAt }: TopBarProps) {
  const lastRefresh = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : "—";

  return (
    <div className="h-12 bg-[#181825] border-b border-[#313244] flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-[#cdd6f4] tracking-wide">
          ctx-link
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-[#585b70]">
          <span
            className={`w-2 h-2 rounded-full ${isLoading ? "bg-[#f9e2af] animate-pulse" : "bg-[#a6e3a1]"}`}
          />
          <span>{lastRefresh}</span>
        </div>
        {machineId && (
          <span className="font-mono text-xs text-[#a6adc8] bg-[#1e1e2e] px-2 py-1 rounded">
            {machineId.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}
