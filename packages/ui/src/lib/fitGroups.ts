import type { Node } from "@xyflow/react";

const PADDING = 60;
const HEADER = 40;

// Estimated node dimensions (must match buildGraph constants)
const NODE_WIDTHS: Record<string, number> = { project: 220, bundle: 200 };
const NODE_HEIGHTS: Record<string, number> = { bundle: 88 };
const PROJECT_ROW = 32;
const PROJECT_HEADER = 36;

function estimateHeight(node: Node): number {
  if (node.type === "bundle") return NODE_HEIGHTS.bundle;
  if (node.type === "project") {
    const sessions = (node.data as any)?.sessions;
    const count = Array.isArray(sessions) ? sessions.length : 1;
    return PROJECT_HEADER + Math.max(count, 1) * PROJECT_ROW + 8;
  }
  return 100;
}

function estimateWidth(node: Node): number {
  return NODE_WIDTHS[node.type ?? ""] ?? 200;
}

/**
 * Recalculate group node sizes to fit their children with padding.
 * Mutates the nodes array in place for performance (called on every drag).
 */
export function fitGroupsToChildren(nodes: Node[]): Node[] {
  // Collect group IDs
  const groupIds = new Set<string>();
  for (const n of nodes) {
    if (n.type === "teamGroup") groupIds.add(n.id);
  }
  if (groupIds.size === 0) return nodes;

  // For each group, find children bounds
  for (const groupId of groupIds) {
    const children = nodes.filter((n) => n.parentId === groupId);
    if (children.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of children) {
      const w = estimateWidth(c);
      const h = estimateHeight(c);
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + w);
      maxY = Math.max(maxY, c.position.y + h);
    }

    const group = nodes.find((n) => n.id === groupId);
    if (!group) continue;

    const needWidth = maxX - minX + PADDING * 2;
    const needHeight = maxY - minY + PADDING + HEADER;

    // Only grow, don't shrink below the content + padding
    const curWidth = (group.style as any)?.width ?? 0;
    const curHeight = (group.style as any)?.height ?? 0;
    const newWidth = Math.max(needWidth, 200);
    const newHeight = Math.max(needHeight, 100);

    if (Math.abs(newWidth - curWidth) > 2 || Math.abs(newHeight - curHeight) > 2) {
      group.style = { ...group.style, width: newWidth, height: newHeight };
    }
  }

  return nodes;
}
