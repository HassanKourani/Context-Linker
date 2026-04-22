import type { Node, Edge } from "@xyflow/react";
import type { GraphData, BundleGraphData } from "../types";
import { computeLayout, type LayoutNode, type LayoutEdge } from "./layout";
import { teamColor, LOCAL_GROUP_COLOR } from "./colors";

const PROJECT_NODE_WIDTH = 220;
const PROJECT_NODE_HEADER = 36;
const PROJECT_NODE_ROW = 32;
const BUNDLE_NODE_WIDTH = 200;
const BUNDLE_NODE_HEIGHT = 88;
const GROUP_PADDING = 40;
const GROUP_HEADER = 30;
const GROUP_GAP = 60;

function projectNodeHeight(sessionCount: number): number {
  return PROJECT_NODE_HEADER + Math.max(sessionCount, 1) * PROJECT_NODE_ROW + 8;
}

interface GroupInput {
  groupId: string;
  groupName: string;
  color: string;
  bundles: BundleGraphData[];
  machineId: string;
  isLocal: boolean;
}

function buildGroup(input: GroupInput): { nodes: Node[]; edges: Edge[] } {
  const { groupId, groupName, color, bundles, machineId, isLocal } = input;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all unique projects across bundles
  const projectSessions = new Map<
    string,
    Array<{ sessionId: string; machineId: string; lastActiveAt: string | null; bundleId: string }>
  >();

  for (const bundle of bundles) {
    if (isLocal) {
      // Local bundles: synthesize sessions from projects
      for (const proj of (bundle as any).projects ?? []) {
        const key = proj.project_name;
        if (!projectSessions.has(key)) projectSessions.set(key, []);
        projectSessions.get(key)!.push({
          sessionId: `local-${bundle.bundle_id}-${proj.project_name}`,
          machineId: machineId,
          lastActiveAt: proj.last_entry_at,
          bundleId: bundle.bundle_id,
        });
      }
    } else {
      for (const session of bundle.sessions) {
        const key = session.project_name;
        if (!projectSessions.has(key)) projectSessions.set(key, []);
        projectSessions.get(key)!.push({
          sessionId: session.session_id,
          machineId: session.machine_id,
          lastActiveAt: session.last_active_at,
          bundleId: bundle.bundle_id,
        });
      }
    }
  }

  // Build layout nodes
  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  // Project nodes
  for (const [projectName, sessions] of projectSessions) {
    const nodeId = `project-${groupId}-${projectName}`;
    layoutNodes.push({
      id: nodeId,
      width: PROJECT_NODE_WIDTH,
      height: projectNodeHeight(sessions.length),
    });

    for (const s of sessions) {
      layoutEdges.push({
        source: nodeId,
        target: `bundle-${s.bundleId}`,
      });
    }
  }

  // Bundle nodes
  for (const bundle of bundles) {
    layoutNodes.push({
      id: `bundle-${bundle.bundle_id}`,
      width: BUNDLE_NODE_WIDTH,
      height: BUNDLE_NODE_HEIGHT,
    });
  }

  if (layoutNodes.length === 0) return { nodes, edges };

  // Compute layout
  const layout = computeLayout(layoutNodes, layoutEdges);

  // Group node dimensions
  const groupWidth = layout.graphWidth + GROUP_PADDING * 2;
  const groupHeight = layout.graphHeight + GROUP_PADDING * 2 + GROUP_HEADER;

  // Group node
  nodes.push({
    id: groupId,
    type: "teamGroup",
    position: { x: 0, y: 0 }, // positioned later by caller
    data: { teamName: groupName, color },
    style: { width: groupWidth, height: groupHeight },
  });

  // Project nodes (children of group)
  for (const [projectName, sessions] of projectSessions) {
    const nodeId = `project-${groupId}-${projectName}`;
    const pos = layout.positions.get(nodeId)!;

    nodes.push({
      id: nodeId,
      type: "project",
      position: { x: pos.x + GROUP_PADDING, y: pos.y + GROUP_PADDING + GROUP_HEADER },
      parentId: groupId,
      extent: "parent" as const,
      data: {
        projectName,
        sessions: sessions.map((s) => ({
          id: s.sessionId,
          machineId: s.machineId,
          lastActiveAt: s.lastActiveAt,
          isYou: s.machineId === machineId,
        })),
      },
    });
  }

  // Bundle nodes (children of group)
  for (const bundle of bundles) {
    const nodeId = `bundle-${bundle.bundle_id}`;
    const pos = layout.positions.get(nodeId)!;

    nodes.push({
      id: nodeId,
      type: "bundle",
      position: { x: pos.x + GROUP_PADDING, y: pos.y + GROUP_PADDING + GROUP_HEADER },
      parentId: groupId,
      extent: "parent" as const,
      data: {
        bundleName: bundle.bundle_name,
        entryCount: bundle.entry_count,
        lastEntryAt: bundle.last_entry_at,
      },
    });
  }

  // Edges
  for (const [projectName, sessions] of projectSessions) {
    for (const s of sessions) {
      edges.push({
        id: `edge-${s.sessionId}`,
        source: `project-${groupId}-${projectName}`,
        sourceHandle: s.sessionId,
        target: `bundle-${s.bundleId}`,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#585b70", strokeWidth: 2 },
      });
    }
  }

  return { nodes, edges };
}

export function buildFlowGraph(
  data: GraphData
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  let yOffset = 0;

  // Team groups
  for (const team of data.teams) {
    const { nodes, edges } = buildGroup({
      groupId: `team-${team.team_id}`,
      groupName: team.team_name,
      color: teamColor(team.team_name),
      bundles: team.bundles,
      machineId: data.machine_id,
      isLocal: false,
    });

    // Offset group position
    const groupNode = nodes.find((n) => n.id === `team-${team.team_id}`);
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
      const h = (groupNode.style as any)?.height ?? 200;
      yOffset += h + GROUP_GAP;
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  // Local group
  if (data.local.bundles.length > 0) {
    const { nodes, edges } = buildGroup({
      groupId: "local",
      groupName: "Local",
      color: LOCAL_GROUP_COLOR,
      bundles: data.local.bundles as any,
      machineId: data.machine_id,
      isLocal: true,
    });

    const groupNode = nodes.find((n) => n.id === "local");
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  return { nodes: allNodes, edges: allEdges };
}
