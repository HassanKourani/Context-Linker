import {
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

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

  const color = (data as any)?._color ?? "#585b70";
  const isHovered = (data as any)?._hovered as boolean | undefined;
  const isDimmed = (data as any)?._dimmed as boolean | undefined;

  let strokeOpacity: number;
  let strokeWidth: number;

  if (isHovered || selected) {
    strokeOpacity = 1;
    strokeWidth = 2.5;
  } else if (isDimmed) {
    strokeOpacity = 0.12;
    strokeWidth = 1.5;
  } else {
    strokeOpacity = 0.55;
    strokeWidth = 2;
  }

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        style={{
          transition: "stroke-opacity 0.2s, stroke-width 0.2s",
          pointerEvents: "none",
        }}
        className="react-flow__edge-path"
      />
    </>
  );
}
