import { useMemo, useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type EdgeTypes,
  type EdgeMouseHandler,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { useConnectSession } from "./hooks/mutations/useConnectSession";
import { useGraphData } from "./hooks/useGraphData";
import { useUIStore } from "./stores/uiStore";
import { buildFlowGraph } from "./lib/buildGraph";
import { hoverEdge, unhoverEdge } from "./lib/edgeHover";
import { ProjectNode } from "./components/nodes/ProjectNode";
import { BundleNode } from "./components/nodes/BundleNode";
import { TeamGroupNode } from "./components/nodes/TeamGroupNode";
import { TopBar } from "./components/TopBar";
import { CreateBundleDialog } from "./components/CreateBundleDialog";
import { DeleteBundleDialog } from "./components/DeleteBundleDialog";
import { EntryPanel } from "./components/EntryPanel";
import { PushEntryDialog } from "./components/PushEntryForm";
import { RewindDialog } from "./components/RewindDialog";
import { TeamManagementDialog } from "./components/TeamManagementDialog";
import { DeletableEdge } from "./components/edges/DeletableEdge";

const nodeTypes: NodeTypes = {
  project: ProjectNode,
  bundle: BundleNode,
  teamGroup: TeamGroupNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
};

export function App() {
  const { data, isLoading, dataUpdatedAt } = useGraphData();
  const hoveredEdgeId = useUIStore((s) => s.hoveredEdgeId);

  // Build graph from API data
  const built = useMemo(
    () => (data ? buildFlowGraph(data) : { nodes: [], edges: [] }),
    [data]
  );

  // Controlled node/edge state — allows dragging to update positions
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  // Sync when API data changes — preserve positions of nodes the user has dragged
  useEffect(() => {
    setNodes((current) => {
      const posMap = new Map<string, { x: number; y: number }>();
      for (const n of current) {
        posMap.set(n.id, n.position);
      }
      return built.nodes.map((n) => {
        const saved = posMap.get(n.id);
        return saved ? { ...n, position: saved } : n;
      });
    });
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  // Inject _hovered into the hovered edge's data
  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === hoveredEdgeId
          ? { ...e, data: { ...e.data, _hovered: true } }
          : e.data?._hovered
            ? { ...e, data: { ...e.data, _hovered: false } }
            : e
      )
    );
  }, [hoveredEdgeId, setEdges]);

  const connectMutation = useConnectSession();

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;
      if (sourceNode.type !== "project" || targetNode.type !== "bundle") return;

      const bundleId = (targetNode.data as any).bundleId;
      const mode = (targetNode.data as any).mode || "cloud";
      const sessionId = connection.sourceHandle;

      if (!bundleId || !sessionId) return;

      connectMutation.mutate({ sessionId, bundle_id: bundleId, mode });
    },
    [nodes, connectMutation]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      return source?.type === "project" && target?.type === "bundle";
    },
    [nodes]
  );

  const onEdgeMouseEnter: EdgeMouseHandler = useCallback((_event, edge) => {
    hoverEdge(edge.id);
  }, []);

  const onEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    unhoverEdge();
  }, []);

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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={true}
          nodesDraggable={true}
          elementsSelectable={true}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
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
      <EntryPanel />
      <PushEntryDialog />
      <RewindDialog />
      <TeamManagementDialog />
    </div>
  );
}
