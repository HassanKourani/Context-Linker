import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { useJoinBundle } from "./hooks/mutations/useJoinBundle";
import { useGraphData } from "./hooks/useGraphData";
import { buildFlowGraph } from "./lib/buildGraph";
import { ProjectNode } from "./components/nodes/ProjectNode";
import { BundleNode } from "./components/nodes/BundleNode";
import { TeamGroupNode } from "./components/nodes/TeamGroupNode";
import { TopBar } from "./components/TopBar";
import { CreateBundleDialog } from "./components/CreateBundleDialog";
import { DeleteBundleDialog } from "./components/DeleteBundleDialog";

const nodeTypes: NodeTypes = {
  project: ProjectNode,
  bundle: BundleNode,
  teamGroup: TeamGroupNode,
};

export function App() {
  const { data, isLoading, dataUpdatedAt } = useGraphData();

  const { nodes, edges } = useMemo(
    () => (data ? buildFlowGraph(data) : { nodes: [], edges: [] }),
    [data]
  );

  const joinMutation = useJoinBundle();

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;
      if (connection.sourceHandle !== "new-connection") return;

      const projectName = (sourceNode.data as any).projectName;
      const bundleId = (targetNode.data as any).bundleId;
      const mode = (targetNode.data as any).mode || "cloud";

      if (!projectName || !bundleId) return;

      joinMutation.mutate({ bundleId, project_name: projectName, mode });
    },
    [nodes, joinMutation]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (connection.sourceHandle !== "new-connection") return false;
      const target = nodes.find((n) => n.id === connection.target);
      return target?.type === "bundle";
    },
    [nodes]
  );

  return (
    <div className="h-screen w-screen bg-[#11111b] text-[#cdd6f4] flex flex-col">
      <TopBar
        machineId={data?.machine_id}
        isLoading={isLoading}
        dataUpdatedAt={dataUpdatedAt}
      />
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={true}
          nodesDraggable={false}
          elementsSelectable={true}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionLineStyle={{ stroke: "#a6e3a1", strokeWidth: 2 }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#313244" gap={20} size={1} />
          <Controls
            showInteractive={false}
            className="!bg-[#1e1e2e] !border-[#313244] !shadow-lg [&>button]:!bg-[#1e1e2e] [&>button]:!border-[#313244] [&>button]:!fill-[#cdd6f4] [&>button:hover]:!bg-[#313244]"
          />
          <MiniMap
            nodeColor="#313244"
            maskColor="rgba(17, 17, 27, 0.8)"
            className="!bg-[#181825] !border-[#313244]"
          />
        </ReactFlow>
      </div>
      <CreateBundleDialog />
      <DeleteBundleDialog />
    </div>
  );
}
