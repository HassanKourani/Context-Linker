import type { NodeProps } from "@xyflow/react";

export function TeamGroupNode({ data }: NodeProps) {
  const { teamName, color } = data as { teamName: string; color: string };

  // Build colored variants from any color format (hsl/hex)
  const tintTop = color.startsWith("hsl")
    ? color.replace(")", ", 0.10)").replace("hsl", "hsla")
    : color;
  const tintFill = color.startsWith("hsl")
    ? color.replace(")", ", 0.035)").replace("hsl", "hsla")
    : color;

  return (
    <div
      className="w-full h-full rounded-2xl relative"
      style={{
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${tintTop} 0%, transparent 70%), ${tintFill}`,
        boxShadow: `inset 0 1px 0 0 ${color}22`,
      }}
    >
      {/* Refined dashed border via SVG — visible but not heavy */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
        preserveAspectRatio="none"
      >
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="14"
          ry="14"
          fill="none"
          stroke={color}
          strokeOpacity="0.85"
          strokeWidth="1.25"
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
      </svg>

      {/* Floating label chip */}
      <div
        className="absolute -top-2.5 left-5 flex items-center gap-1.5 px-2.5 py-0.5 rounded-md"
        style={{
          background: "#11111b",
          boxShadow:
            "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.06), 0 4px 12px -4px rgba(0,0,0,0.6)",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span
          className="text-[10px] font-medium tracking-[0.14em] uppercase"
          style={{ color }}
        >
          {teamName}
        </span>
      </div>
    </div>
  );
}
