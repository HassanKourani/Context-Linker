import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const sessionId = (data as any)?.sessionId as string | undefined;
  const isHovered = (data as any)?._hovered as boolean | undefined;
  const deleteMutation = useDeleteSession();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!sessionId) return;
    deleteMutation.mutate(sessionId);
  };

  const showButton = isHovered || selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={20}
        style={{
          stroke: showButton ? "#f38ba8" : "#585b70",
          strokeWidth: showButton ? 2.5 : 2,
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />
      {sessionId && showButton && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            <button
              className="bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:scale-125 cursor-pointer transition-transform border border-destructive-foreground/20"
              onClick={handleDelete}
              onMouseDown={(e) => e.stopPropagation()}
              title="Unlink session"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
