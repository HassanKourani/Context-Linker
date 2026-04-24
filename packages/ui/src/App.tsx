import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type ReactFlowInstance,
  type NodeTypes,
  type EdgeTypes,
  type EdgeMouseHandler,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useGraphData } from "./hooks/useGraphData";
import { useUIStore } from "./stores/uiStore";
import { buildFlowGraph } from "./lib/buildGraph";
import { hoverEdge, unhoverEdge } from "./lib/edgeHover";
import { fitGroupsToChildren } from "./lib/fitGroups";
import { ProjectNode } from "./components/nodes/ProjectNode";
import { BundleNode } from "./components/nodes/BundleNode";
import { QuestionsNode } from "./components/nodes/QuestionsNode";
import { TeamGroupNode } from "./components/nodes/TeamGroupNode";
import { TopBar } from "./components/TopBar";
import { CreateBundleDialog } from "./components/CreateBundleDialog";
import { DeleteBundleDialog } from "./components/DeleteBundleDialog";
import { EntryPanel } from "./components/EntryPanel";
import { QuestionsPanel } from "./components/QuestionsPanel";
import { PushEntryDialog } from "./components/PushEntryForm";
import { RewindDialog } from "./components/RewindDialog";
import { TeamManagementDialog } from "./components/TeamManagementDialog";
import { PushSessionToBundleDialog } from "./components/PushSessionToBundleDialog";
import { ConnectSessionDialog } from "./components/ConnectSessionDialog";
import { DeletableEdge } from "./components/edges/DeletableEdge";
import { EdgeActionDialog } from "./components/EdgeActionDialog";
import { PushBundleToCloudDialog } from "./components/PushBundleToCloudDialog";

const nodeTypes: NodeTypes = {
  project: ProjectNode,
  bundle: BundleNode,
  teamGroup: TeamGroupNode,
  questions: QuestionsNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
};

export function App() {
  const { data, isLoading, dataUpdatedAt } = useGraphData();
  const hoveredEdgeId = useUIStore((s) => s.hoveredEdgeId);
  const hideEmptySessions = useUIStore((s) => s.hideEmptySessions);
  const hideEmptyQuestions = useUIStore((s) => s.hideEmptyQuestions);
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // Build graph from API data
  const built = useMemo(
    () => (data ? buildFlowGraph(data, { hideEmptySessions, hideEmptyQuestions }) : { nodes: [], edges: [] }),
    [data, hideEmptySessions, hideEmptyQuestions]
  );

  // Controlled node/edge state — allows dragging to update positions
  const [nodes, setNodes, baseOnNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  // Persist node positions to localStorage
  const savePositions = useCallback((ns: Node[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of ns) {
      positions[n.id] = n.position;
    }
    try { localStorage.setItem("ctx-link-node-positions", JSON.stringify(positions)); } catch {}
  }, []);

  const loadPositions = useCallback((): Map<string, { x: number; y: number }> => {
    try {
      const raw = localStorage.getItem("ctx-link-node-positions");
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch { return new Map(); }
  }, []);

  // Reset all nodes to dagre-computed positions (tidy up)
  const tidyUp = useCallback(() => {
    try { localStorage.removeItem("ctx-link-node-positions"); } catch {}
    setNodes(fitGroupsToChildren([...built.nodes]));
    setEdges(built.edges);
    // Re-center viewport after layout reset
    requestAnimationFrame(() => {
      rfInstance.current?.fitView({ padding: 0.2 });
    });
  }, [built, setNodes, setEdges]);

  // Wrap onNodesChange to recalculate group bounds after dragging + persist
  const onNodesChange = useCallback(
    (changes: any) => {
      baseOnNodesChange(changes);
      const hasDragEnd = changes.some((c: any) => c.type === "position" && !c.dragging && c.position);
      const hasDrag = changes.some((c: any) => c.type === "position" && c.dragging);
      if (hasDrag) {
        setNodes((ns) => fitGroupsToChildren([...ns]));
      }
      if (hasDragEnd) {
        setNodes((ns) => { savePositions(ns); return ns; });
      }
    },
    [baseOnNodesChange, setNodes, savePositions]
  );

  // Sync when API data changes — restore saved positions
  useEffect(() => {
    setNodes((current) => {
      // Merge: saved localStorage > current state > dagre default
      const stored = loadPositions();
      const currentMap = new Map<string, { x: number; y: number }>();
      for (const n of current) {
        currentMap.set(n.id, n.position);
      }

      const merged = built.nodes.map((n) => {
        const pos = stored.get(n.id) ?? currentMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      return fitGroupsToChildren(merged);
    });
    setEdges(built.edges);
  }, [built, setNodes, setEdges, loadPositions]);

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

  const openModal = useUIStore((s) => s.openModal);
  const setPendingConnectPush = useUIStore((s) => s.setPendingConnectPush);
  const setPendingEdgeAction = useUIStore((s) => s.setPendingEdgeAction);

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const sessionId = (edge.data as any)?.sessionId as string | undefined;
      const bundleId = (edge.data as any)?.bundleId as string | undefined;
      if (!sessionId || !bundleId) return;
      setPendingEdgeAction({ sessionId, bundleId, action: "push" });
      openModal("edge-action");
    },
    [openModal, setPendingEdgeAction]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;
      if (sourceNode.type !== "project" || targetNode.type !== "bundle") return;

      const bundleId = (targetNode.data as any).bundleId;
      const sessionId = connection.sourceHandle;

      if (!bundleId || !sessionId) return;

      setPendingConnectPush({ sessionId, bundleId });
      openModal("connect-and-push");
    },
    [nodes, openModal, setPendingConnectPush]
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
        onTidyUp={tidyUp}
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
          onEdgeClick={onEdgeClick}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onInit={(instance) => { rfInstance.current = instance; }}
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
      <QuestionsPanel />
      <PushEntryDialog />
      <RewindDialog />
      <TeamManagementDialog />
      <PushSessionToBundleDialog />
      <ConnectSessionDialog />
      <EdgeActionDialog />
      <PushBundleToCloudDialog />
    </div>
  );
}
