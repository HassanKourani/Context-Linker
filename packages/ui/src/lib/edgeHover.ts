import { useUIStore } from "@/stores/uiStore";

let leaveTimer: ReturnType<typeof setTimeout> | null = null;

export function hoverEdge(edgeId: string) {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  useUIStore.getState().setHoveredEdge(edgeId);
}

export function unhoverEdge() {
  leaveTimer = setTimeout(() => {
    useUIStore.getState().setHoveredEdge(null);
  }, 400);
}

export function keepEdgeHovered() {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
}
