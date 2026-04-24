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

  const isHovered = (data as any)?._hovered as boolean | undefined;
  const highlight = isHovered || selected;

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
        stroke={highlight ? "#89b4fa" : "#585b70"}
        strokeWidth={highlight ? 2.5 : 2}
        style={{
          transition: "stroke 0.15s, stroke-width 0.15s",
          pointerEvents: "none",
        }}
        className="react-flow__edge-path"
      />
    </>
  );
}
