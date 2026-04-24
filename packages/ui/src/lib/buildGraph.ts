import type { Node, Edge } from "@xyflow/react";
import type { GraphData, BundleGraphData, ActiveSessionData, CloudSessionData } from "../types";
import { computeLayout, type LayoutNode, type LayoutEdge } from "./layout";
import { teamColor, LOCAL_GROUP_COLOR } from "./colors";

const PROJECT_NODE_WIDTH = 220;
const PROJECT_NODE_HEADER = 36;
const PROJECT_NODE_ROW = 32;
const BUNDLE_NODE_WIDTH = 200;
const BUNDLE_NODE_HEIGHT = 88;
const QUESTIONS_NODE_SIZE = 40;
const QUESTIONS_NODE_GAP = 12;
const GROUP_PADDING = 40;
const GROUP_HEADER = 36;
const GROUP_GAP = 40;

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
  hideEmptyQuestions?: boolean;
}

function buildGroup(input: GroupInput): { nodes: Node[]; edges: Edge[] } {
  const { groupId, groupName, color, bundles, machineId, isLocal, activeSessions, cloudSessions, hideEmptyQuestions } = input;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all unique projects across bundles
  const projectSessions = new Map<
    string,
    Array<{ sessionId: string; name: string | null; machineId: string; lastActiveAt: string | null; bundleId: string; branch: string | null; entryCount: number; cloudSessionId?: string | null }>
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
          name: as.name ?? null,
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
        if (as.cloud_copies) {
          for (const c of as.cloud_copies) activeCloudIds.add(c.cloud_session_id);
        }
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
          name: cs.name ?? null,
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
  // Add one phantom edge per project to the first bundle to enforce LR ranking
  // without creating a full bipartite graph that distorts the layout.
  const projectNodeIds = [...projectSessions.keys()].map((p) => `project-${groupId}-${p}`);
  const bundleNodeIds = bundles.map((b) => `bundle-${b.bundle_id}`);
  const realTargets = new Set(layoutEdges.map((e) => `${e.source}->${e.target}`));
  if (bundleNodeIds.length > 0) {
    for (const pid of projectNodeIds) {
      // Only add phantom edge if this project has no real edge to any bundle
      const hasRealEdge = bundleNodeIds.some((bid) => realTargets.has(`${pid}->${bid}`));
      if (!hasRealEdge) {
        layoutEdges.push({ source: pid, target: bundleNodeIds[0] });
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
            name: s.name,
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

    const bundleX = pos.x + GROUP_PADDING;
    const bundleY = pos.y + GROUP_PADDING + GROUP_HEADER;

    nodes.push({
      id: nodeId,
      type: "bundle",
      position: { x: bundleX, y: bundleY },
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

    // Questions node (circle above bundle, connected from top)
    if (isLocal && !(hideEmptyQuestions && ((bundle as any).question_count ?? 0) === 0)) {
      const qNodeId = `questions-${bundle.bundle_id}`;
      const qCount = (bundle as any).question_count ?? 0;
      nodes.push({
        id: qNodeId,
        type: "questions",
        position: {
          x: bundleX + BUNDLE_NODE_WIDTH / 2 - QUESTIONS_NODE_SIZE / 2,
          y: bundleY - QUESTIONS_NODE_SIZE - QUESTIONS_NODE_GAP,
        },
        parentId: groupId,
        expandParent: true,
        data: {
          bundleId: bundle.bundle_id,
          bundleName: bundle.bundle_name,
          questionCount: qCount,
        },
      });
      edges.push({
        id: `qedge-${bundle.bundle_id}`,
        source: nodeId,
        sourceHandle: "questions",
        target: qNodeId,
        type: "straight",
        style: { stroke: qCount > 0 ? "#df8e1d" : "#585b70", strokeWidth: 1.5, opacity: qCount > 0 ? 0.8 : 0.3 },
        animated: false,
      });
    }
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

  // Edges from cloud sessions to their connected bundles
  // (derived from bundle_entry_refs on the server side)
  if (cloudSessions) {
    const activeCloudIds2 = new Set<string>();
    if (activeSessions) {
      for (const as of activeSessions) {
        if (as.cloud_session_id) activeCloudIds2.add(as.cloud_session_id);
        if (as.cloud_copies) {
          for (const c of as.cloud_copies) activeCloudIds2.add(c.cloud_session_id);
        }
      }
    }

    for (const cs of cloudSessions) {
      // Skip cloud sessions already represented by an active session (edges handled above)
      if (activeCloudIds2.has(cs.id)) continue;
      if (!cs.bundles?.length) continue;
      if (!projectSessions.has(cs.project_name)) continue;

      const projectNodeId = `project-${groupId}-${cs.project_name}`;

      for (const b of cs.bundles) {
        const edgeId = `edge-cloud-${cs.id}-${b.bundle_id}`;
        if (edges.some((e) => e.id === edgeId)) continue;

        edges.push({
          id: edgeId,
          source: projectNodeId,
          sourceHandle: cs.id,
          target: `bundle-${b.bundle_id}`,
          type: "deletable",
          animated: true,
          data: {
            sessionId: cs.id,
            bundleId: b.bundle_id,
            projectName: cs.project_name,
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
  options?: { hideEmptySessions?: boolean; hideEmptyQuestions?: boolean }
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];

  // Active sessions always stay in the local group — they represent
  // the current Claude Code session on this machine. Edges to cloud
  // bundles cross groups naturally.
  const localActiveSessions: ActiveSessionData[] = options?.hideEmptySessions
    ? (data.sessions ?? []).filter((s) => s.entry_count === undefined || s.entry_count > 0)
    : (data.sessions ?? []);

  // Collect cloud session IDs that are backing an active local session
  // so they don't show up as separate nodes in team groups.
  const hiddenCloudIds = new Set<string>();
  for (const s of localActiveSessions) {
    if (s.cloud_session_id) hiddenCloudIds.add(s.cloud_session_id);
    if (s.cloud_copies) {
      for (const c of s.cloud_copies) hiddenCloudIds.add(c.cloud_session_id);
    }
  }

  // Build LOCAL group (left column)
  const hasLocalContent = data.local.bundles.length > 0 || localActiveSessions.length > 0;
  let localWidth = 0;
  let localHeight = 0;

  if (hasLocalContent) {
    const { nodes, edges } = buildGroup({
      groupId: "local",
      groupName: "Local",
      color: LOCAL_GROUP_COLOR,
      bundles: data.local.bundles as any,
      machineId: data.machine_id,
      isLocal: true,
      activeSessions: localActiveSessions,
      hideEmptyQuestions: options?.hideEmptyQuestions,
    });

    const groupNode = nodes.find((n) => n.id === "local");
    if (groupNode) {
      groupNode.position = { x: 0, y: 0 };
      localWidth = (groupNode.style as any)?.width ?? 200;
      localHeight = (groupNode.style as any)?.height ?? 200;
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  // Build team groups (right column, stacked vertically)
  // Positioned to the right of LOCAL so cross-group edges flow left→right
  const rightColumnX = hasLocalContent ? localWidth + GROUP_GAP : 0;

  // First pass: build all team groups and measure total height
  const teamResults: Array<{ nodes: Node[]; edges: Edge[]; height: number }> = [];
  let totalTeamHeight = 0;

  for (const team of data.teams) {
    const visibleCloudSessions = team.cloud_sessions?.filter(
      (cs) => !hiddenCloudIds.has(cs.id)
    );

    const { nodes, edges } = buildGroup({
      groupId: `team-${team.team_id}`,
      groupName: team.team_name,
      color: teamColor(team.team_name),
      bundles: team.bundles,
      machineId: data.machine_id,
      isLocal: false,
      cloudSessions: visibleCloudSessions,
    });

    const groupNode = nodes.find((n) => n.id === `team-${team.team_id}`);
    const h = (groupNode?.style as any)?.height ?? 200;
    teamResults.push({ nodes, edges, height: h });
    totalTeamHeight += h;
  }
  if (teamResults.length > 1) totalTeamHeight += GROUP_GAP * (teamResults.length - 1);

  // Vertically center team groups relative to LOCAL
  let teamYOffset = Math.max(0, (localHeight - totalTeamHeight) / 2);

  for (const tr of teamResults) {
    const groupNode = tr.nodes.find((n) => n.type === "teamGroup");
    if (groupNode) {
      groupNode.position = { x: rightColumnX, y: teamYOffset };
      teamYOffset += tr.height + GROUP_GAP;
    }

    allNodes.push(...tr.nodes);
    allEdges.push(...tr.edges);
  }

  return { nodes: allNodes, edges: allEdges };
}
