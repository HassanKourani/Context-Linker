import { create } from "zustand";

interface DeleteTarget {
  id: string;
  name: string;
}

type ModalType =
  | "create-bundle"
  | "delete-bundle"
  | "team-management"
  | "push-entry"
  | "push-session"
  | "rewind"
  | null;

type PanelView =
  | { kind: "bundle"; bundleId: string; filterProject: string | null }
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

  // Graph filters
  hideEmptySessions: boolean;

  // Actions
  openBundlePanel: (bundleId: string, filterProject?: string) => void;
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
  toggleHideEmptySessions: () => void;

  // Legacy compat
  openPanel: (bundleId: string, filterProject?: string) => void;
  selectedBundleId: string | null;
  filterProject: string | null;
}

export const useUIStore = create<UIState>((set, get) => ({
  panel: null,
  panelTab: "entries",
  activeModal: null,
  deleteBundleTarget: null,
  selectedEntryIds: new Set(),
  hoveredEdgeId: null,
  hideEmptySessions: (() => {
    try { return localStorage.getItem("ctx-link-hide-empty-sessions") === "true"; } catch { return false; }
  })(),

  // Computed getters for backward compat
  get selectedBundleId() {
    const p = get().panel;
    return p?.kind === "bundle" ? p.bundleId : null;
  },
  get filterProject() {
    const p = get().panel;
    return p?.kind === "bundle" ? p.filterProject : null;
  },

  openBundlePanel: (bundleId, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, filterProject: filterProject ?? null },
      panelTab: "entries",
    }),

  openSessionPanel: (sessionId, projectName) =>
    set({
      panel: { kind: "session", sessionId, projectName },
      panelTab: "entries",
    }),

  // Legacy alias
  openPanel: (bundleId, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, filterProject: filterProject ?? null },
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

  toggleHideEmptySessions: () =>
    set((state) => {
      const next = !state.hideEmptySessions;
      try { localStorage.setItem("ctx-link-hide-empty-sessions", String(next)); } catch {}
      return { hideEmptySessions: next };
    }),
}));
