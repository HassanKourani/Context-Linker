import type { Node, Edge } from "@xyflow/react";
import type { GraphData, BundleGraphData, ActiveSessionData, CloudSessionData } from "../types";
import { computeLayout, type LayoutNode, type LayoutEdge } from "./layout";
import { teamColor, LOCAL_GROUP_COLOR } from "./colors";

const PROJECT_NODE_WIDTH = 220;
const PROJECT_NODE_HEADER = 36;
const PROJECT_NODE_ROW = 32;
const BUNDLE_NODE_WIDTH = 200;
const BUNDLE_NODE_HEIGHT = 88;
const GROUP_PADDING = 60;
const GROUP_HEADER = 40;
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
  activeSessions?: ActiveSessionData[];
  cloudSessions?: CloudSessionData[];
}

function buildGroup(input: GroupInput): { nodes: Node[]; edges: Edge[] } {
  const { groupId, groupName, color, bundles, machineId, isLocal, activeSessions, cloudSessions } = input;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all unique projects across bundles
  const projectSessions = new Map<
    string,
    Array<{ sessionId: string; machineId: string; lastActiveAt: string | null; bundleId: string; branch: string | null; entryCount: number; cloudSessionId?: string | null }>
  >();

  // Add active sessions (each Claude Code session becomes ONE row under its project)
  // The session row has no bundleId — edges to bundles are created separately below
  if (activeSessions) {
    for (const as of activeSessions) {
      const key = as.project_name;
      if (!projectSessions.has(key)) projectSessions.set(key, []);
      const existing = projectSessions.get(key)!;
      if (!existing.some((e) => e.sessionId === as.session_id)) {
        existing.push({
          sessionId: as.session_id,
          machineId: machineId,
          lastActiveAt: as.started_at,
          bundleId: "",
          branch: as.branch,
          entryCount: as.entry_count ?? 0,
          cloudSessionId: as.cloud_session_id ?? null,
        });
      }
    }
  }

  // Add cloud sessions (from Supabase — sessions from other machines or past sessions)
  // Skip cloud sessions that are already represented by an active session (same cloud_session_id)
  if (cloudSessions) {
    const activeCloudIds = new Set<string>();
    if (activeSessions) {
      for (const as of activeSessions) {
        if (as.cloud_session_id) activeCloudIds.add(as.cloud_session_id);
      }
    }

    for (const cs of cloudSessions) {
      // Skip if this cloud session is already shown as an active session
      if (activeCloudIds.has(cs.id)) continue;

      const key = cs.project_name;
      if (!projectSessions.has(key)) projectSessions.set(key, []);
      const existing = projectSessions.get(key)!;
      if (!existing.some((e) => e.sessionId === cs.id)) {
        existing.push({
          sessionId: cs.id,
          machineId: cs.machine_id,
          lastActiveAt: cs.last_active_at,
          bundleId: "",
          branch: cs.branch,
          entryCount: cs.entry_count ?? 0,
          cloudSessionId: cs.id,
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
      if (s.bundleId) {
        layoutEdges.push({
          source: nodeId,
          target: `bundle-${s.bundleId}`,
        });
      }
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

  // Ensure dagre always ranks projects left of bundles.
  // Without edges, dagre puts disconnected nodes in the same rank.
  // Add phantom edges from every project to every bundle to enforce LR flow.
  const projectNodeIds = [...projectSessions.keys()].map((p) => `project-${groupId}-${p}`);
  const bundleNodeIds = bundles.map((b) => `bundle-${b.bundle_id}`);
  const realTargets = new Set(layoutEdges.map((e) => `${e.source}->${e.target}`));
  for (const pid of projectNodeIds) {
    for (const bid of bundleNodeIds) {
      if (!realTargets.has(`${pid}->${bid}`)) {
        layoutEdges.push({ source: pid, target: bid });
      }
    }
  }

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
      expandParent: true,
      data: {
        projectName,
        sessions: sessions.map((s, i) => {
          // Compute sequence number: count sessions on the same branch up to this index
          const sameBranchBefore = sessions.slice(0, i).filter((o) => o.branch === s.branch).length;
          return {
            id: s.sessionId,
            machineId: s.machineId,
            lastActiveAt: s.lastActiveAt,
            isYou: s.machineId === machineId,
            bundleId: s.bundleId || null,
            mode: isLocal ? "local" as const : "cloud" as const,
            branch: s.branch,
            entryCount: s.entryCount,
            branchSeq: sameBranchBefore + 1,
            branchTotal: sessions.filter((o) => o.branch === s.branch).length,
            cloudSessionId: s.cloudSessionId ?? null,
          };
        }),
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
      expandParent: true,
      data: {
        bundleId: bundle.bundle_id,
        bundleName: bundle.bundle_name,
        entryCount: bundle.entry_count,
        lastEntryAt: bundle.last_entry_at,
        mode: isLocal ? "local" : "cloud",
      },
    });
  }

  // Edges from Supabase/local sessions to bundles
  for (const [projectName, sessions] of projectSessions) {
    for (const s of sessions) {
      if (s.bundleId) {
        edges.push({
          id: `edge-${s.sessionId}`,
          source: `project-${groupId}-${projectName}`,
          sourceHandle: s.sessionId,
          target: `bundle-${s.bundleId}`,
          type: "deletable",
          animated: true,
          data: {
            sessionId: s.sessionId,
            bundleId: s.bundleId,
            projectName,
            mode: isLocal ? "local" : "cloud",
          },
          style: { stroke: "#585b70", strokeWidth: 2 },
        });
      }
    }
  }

  // Edges from active sessions to their connected bundles
  // (one session can connect to multiple bundles — each gets its own edge)
  // Edges can cross groups (e.g. cloud session → local bundle)
  const groupBundleIds = new Set(bundles.map((b) => b.bundle_id));

  if (activeSessions) {
    for (const as of activeSessions) {
      const projectNodeId = `project-${groupId}-${as.project_name}`;
      // Only create edges if this project has a node in this group
      if (!projectSessions.has(as.project_name)) continue;

      for (const b of as.bundles) {
        const edgeId = `edge-active-${as.session_id}-${b.bundle_id}`;
        // Skip if this edge already exists
        if (edges.some((e) => e.id === edgeId)) continue;

        // For in-group bundles, use dagre layout. For cross-group, still create the edge
        // — React Flow renders cross-parent edges fine.
        edges.push({
          id: edgeId,
          source: projectNodeId,
          sourceHandle: as.session_id,
          target: `bundle-${b.bundle_id}`,
          type: "deletable",
          animated: true,
          data: {
            sessionId: as.session_id,
            bundleId: b.bundle_id,
            projectName: as.project_name,
            mode: b.mode,
          },
          style: { stroke: "#585b70", strokeWidth: 2 },
        });
      }
    }
  }

  return { nodes, edges };
}

export function buildFlowGraph(
  data: GraphData,
  options?: { hideEmptySessions?: boolean }
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  let yOffset = 0;

  // Group active sessions by team or local
  const bundleToTeam = new Map<string, string>();
  for (const team of data.teams) {
    for (const bundle of team.bundles) {
      bundleToTeam.set(bundle.bundle_id, team.team_id);
    }
  }

  // Categorize active sessions into team groups or local
  const sessionsByTeam = new Map<string, ActiveSessionData[]>();
  const localActiveSessions: ActiveSessionData[] = [];

  const filteredSessions = options?.hideEmptySessions
    ? (data.sessions ?? []).filter((s) => s.entry_count === undefined || s.entry_count > 0)
    : data.sessions;

  if (filteredSessions) {
    for (const session of filteredSessions) {
      // Check if session has a team_id (pushed to cloud) or any bundle belongs to a team
      let assignedTeam: string | null = session.team_id ?? null;
      if (!assignedTeam) {
        for (const b of session.bundles) {
          const teamId = bundleToTeam.get(b.bundle_id);
          if (teamId) { assignedTeam = teamId; break; }
        }
      }
      if (assignedTeam) {
        if (!sessionsByTeam.has(assignedTeam)) sessionsByTeam.set(assignedTeam, []);
        sessionsByTeam.get(assignedTeam)!.push(session);
      } else {
        localActiveSessions.push(session);
      }
    }
  }

  // Team groups
  for (const team of data.teams) {
    const teamActiveSessions = sessionsByTeam.get(team.team_id) ?? [];

    const { nodes, edges } = buildGroup({
      groupId: `team-${team.team_id}`,
      groupName: team.team_name,
      color: teamColor(team.team_name),
      bundles: team.bundles,
      machineId: data.machine_id,
      isLocal: false,
      activeSessions: teamActiveSessions,
      cloudSessions: team.cloud_sessions,
    });

    const groupNode = nodes.find((n) => n.id === `team-${team.team_id}`);
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
      const h = (groupNode.style as any)?.height ?? 200;
      yOffset += h + GROUP_GAP;
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  // Local group — all non-team sessions + local bundles
  const hasLocalContent = data.local.bundles.length > 0 || localActiveSessions.length > 0;

  if (hasLocalContent) {
    const { nodes, edges } = buildGroup({
      groupId: "local",
      groupName: "Local",
      color: LOCAL_GROUP_COLOR,
      bundles: data.local.bundles as any,
      machineId: data.machine_id,
      isLocal: true,
      activeSessions: localActiveSessions,
    });

    const groupNode = nodes.find((n) => n.id === "local");
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
      const h = (groupNode.style as any)?.height ?? 200;
      yOffset += h + GROUP_GAP;
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  return { nodes: allNodes, edges: allEdges };
}
