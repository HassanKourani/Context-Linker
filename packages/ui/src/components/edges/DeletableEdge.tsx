import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { keepEdgeHovered, unhoverEdge } from "@/lib/edgeHover";

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
  const bundleId = (data as any)?.bundleId as string | undefined;
  const projectName = (data as any)?.projectName as string | undefined;
  const mode = ((data as any)?.mode as "local" | "cloud") ?? "cloud";
  const isHovered = (data as any)?._hovered as boolean | undefined;
  const deleteMutation = useDeleteSession();

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
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 1000,
            }}
            onMouseEnter={keepEdgeHovered}
            onMouseLeave={unhoverEdge}
          >
            <button
              style={{ pointerEvents: "all", zIndex: 1000 }}
              className="bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:scale-125 cursor-pointer transition-transform border border-destructive-foreground/20"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!sessionId || !bundleId || !projectName) return;
                deleteMutation.mutate({
                  session_id: sessionId,
                  bundle_id: bundleId,
                  project_name: projectName,
                  mode,
                });
              }}
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
