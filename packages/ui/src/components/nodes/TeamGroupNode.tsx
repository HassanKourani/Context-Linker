import type { NodeProps } from "@xyflow/react";

export function TeamGroupNode({ data }: NodeProps) {
  const { teamName, color } = data as { teamName: string; color: string };

  return (
    <div
      className="w-full h-full rounded-xl border-2 border-dashed relative"
      style={{
        borderColor: color,
        backgroundColor: color.replace(")", ", 0.05)").replace("hsl", "hsla"),
      }}
    >
      <span
        className="absolute -top-3 left-4 px-2 text-xs font-bold tracking-wide uppercase"
        style={{ color, backgroundColor: "#11111b" }}
      >
        {teamName}
      </span>
    </div>
  );
}
