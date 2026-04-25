import type { Node } from "@xyflow/react";

// Must match buildGraph constants
const PADDING = 48;
const HEADER = 36;

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
 *
 * Children are positioned relative to the group at (PADDING, PADDING + HEADER)
 * by dagre. The group must extend PADDING past the rightmost / bottommost child.
 */
export function fitGroupsToChildren(nodes: Node[]): Node[] {
  const groupIds = new Set<string>();
  for (const n of nodes) {
    if (n.type === "teamGroup") groupIds.add(n.id);
  }
  if (groupIds.size === 0) return nodes;

  for (const groupId of groupIds) {
    const children = nodes.filter((n) => n.parentId === groupId);
    if (children.length === 0) continue;

    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of children) {
      const w = estimateWidth(c);
      const h = estimateHeight(c);
      maxX = Math.max(maxX, c.position.x + w);
      maxY = Math.max(maxY, c.position.y + h);
    }

    const group = nodes.find((n) => n.id === groupId);
    if (!group) continue;

    // Group extends PADDING past the furthest child edge on each side.
    // Left/top padding is implicit in child positions (set by dagre + GROUP_PADDING offset).
    const newWidth = Math.max(maxX + PADDING, PADDING * 2 + 100);
    const newHeight = Math.max(maxY + PADDING, HEADER + PADDING * 2 + 50);

    const curWidth = (group.style as any)?.width ?? 0;
    const curHeight = (group.style as any)?.height ?? 0;

    if (Math.abs(newWidth - curWidth) > 2 || Math.abs(newHeight - curHeight) > 2) {
      group.style = { ...group.style, width: newWidth, height: newHeight };
    }
  }

  return nodes;
}
