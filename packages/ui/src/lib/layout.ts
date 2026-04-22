import dagre from "dagre";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  graphWidth: number;
  graphHeight: number;
}

const NODE_SEP = 60;
const RANK_SEP = 120;

export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    // dagre returns center coordinates; convert to top-left
    positions.set(node.id, {
      x: pos.x - pos.width / 2,
      y: pos.y - pos.height / 2,
    });
  }

  const graph = g.graph();
  return {
    positions,
    graphWidth: graph.width ?? 0,
    graphHeight: graph.height ?? 0,
  };
}
