import { create } from "zustand";

interface DeleteTarget {
  id: string;
  name: string;
  mode: "local" | "cloud";
}

type ModalType =
  | "create-bundle"
  | "delete-bundle"
  | "team-management"
  | "push-entry"
  | "rewind"
  | null;

type PanelView =
  | { kind: "bundle"; bundleId: string; mode: "local" | "cloud"; filterProject: string | null }
  | { kind: "session"; sessionId: string; projectName: string }
  | null;

interface UIState {
  // Side panel
  panel: PanelView;
  panelTab: "entries" | "rewinds";

  // Modals
  activeModal: ModalType;
  deleteBundleTarget: DeleteTarget | null;

  // Entry selection (for rewind)
  selectedEntryIds: Set<string>;

  // Edge hover
  hoveredEdgeId: string | null;

  // Actions
  openBundlePanel: (bundleId: string, mode: "local" | "cloud", filterProject?: string) => void;
  openSessionPanel: (sessionId: string, projectName: string) => void;
  closePanel: () => void;
  setPanelTab: (tab: "entries" | "rewinds") => void;
  setFilterProject: (project: string | null) => void;
  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setDeleteTarget: (target: DeleteTarget | null) => void;
  toggleEntry: (entryId: string) => void;
  clearEntrySelection: () => void;
  setHoveredEdge: (id: string | null) => void;

  // Legacy compat — keep openPanel as alias for openBundlePanel
  openPanel: (bundleId: string, mode: "local" | "cloud", filterProject?: string) => void;
  selectedBundleId: string | null;
  selectedBundleMode: "local" | "cloud";
  filterProject: string | null;
}

export const useUIStore = create<UIState>((set, get) => ({
  panel: null,
  panelTab: "entries",
  activeModal: null,
  deleteBundleTarget: null,
  selectedEntryIds: new Set(),
  hoveredEdgeId: null,

  // Computed getters for backward compat
  get selectedBundleId() {
    const p = get().panel;
    return p?.kind === "bundle" ? p.bundleId : null;
  },
  get selectedBundleMode() {
    const p = get().panel;
    return p?.kind === "bundle" ? p.mode : "cloud";
  },
  get filterProject() {
    const p = get().panel;
    return p?.kind === "bundle" ? p.filterProject : null;
  },

  openBundlePanel: (bundleId, mode, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, mode, filterProject: filterProject ?? null },
      panelTab: "entries",
    }),

  openSessionPanel: (sessionId, projectName) =>
    set({
      panel: { kind: "session", sessionId, projectName },
      panelTab: "entries",
    }),

  // Legacy alias
  openPanel: (bundleId, mode, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, mode, filterProject: filterProject ?? null },
      panelTab: "entries",
    }),

  closePanel: () =>
    set({ panel: null, selectedEntryIds: new Set() }),

  setPanelTab: (tab) => set({ panelTab: tab }),

  setFilterProject: (project) =>
    set((state) => {
      if (state.panel?.kind !== "bundle") return {};
      return { panel: { ...state.panel, filterProject: project } };
    }),

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () => set({ activeModal: null, deleteBundleTarget: null }),

  setDeleteTarget: (target) => set({ deleteBundleTarget: target }),

  toggleEntry: (entryId) =>
    set((state) => {
      const next = new Set(state.selectedEntryIds);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return { selectedEntryIds: next };
    }),

  clearEntrySelection: () => set({ selectedEntryIds: new Set() }),

  setHoveredEdge: (id) => set({ hoveredEdgeId: id }),
}));
