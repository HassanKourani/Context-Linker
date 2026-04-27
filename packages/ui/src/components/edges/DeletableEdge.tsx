import { getBezierPath, type EdgeProps } from "@xyflow/react";

export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color = (data as any)?._color ?? "#7a7d99";
  const isHovered = (data as any)?._hovered as boolean | undefined;
  const isDimmed = (data as any)?._dimmed as boolean | undefined;
  const active = isHovered || selected;

  let strokeOpacity: number;
  let strokeWidth: number;
  let glowOpacity: number;

  if (active) {
    strokeOpacity = 1;
    strokeWidth = 1.75;
    glowOpacity = 0.45;
  } else if (isDimmed) {
    strokeOpacity = 0.1;
    strokeWidth = 1;
    glowOpacity = 0;
  } else {
    strokeOpacity = 0.5;
    strokeWidth = 1.25;
    glowOpacity = 0.18;
  }

  const gradientId = `edge-grad-${id}`;
  const filterId = `edge-glow-${id}`;

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="55%" stopColor={color} stopOpacity="0.75" />
          <stop offset="100%" stopColor="#cba6f7" stopOpacity="0.55" />
        </linearGradient>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>

      {/* Wide invisible interaction path */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />

      {/* Soft glow underlay — only visible when active or default */}
      {glowOpacity > 0 && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth + 5}
          strokeOpacity={glowOpacity}
          strokeLinecap="round"
          filter={`url(#${filterId})`}
          style={{
            transition: "stroke-opacity 0.2s, stroke-width 0.2s",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Main edge with gradient stroke */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeLinecap="round"
        style={{
          transition: "stroke-opacity 0.2s, stroke-width 0.2s",
          pointerEvents: "none",
        }}
        className="react-flow__edge-path"
      />
    </>
  );
}
