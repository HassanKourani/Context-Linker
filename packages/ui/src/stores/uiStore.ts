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

interface UIState {
  // Side panel
  selectedBundleId: string | null;
  selectedBundleMode: "local" | "cloud";
  panelTab: "entries" | "rewinds";

  // Modals
  activeModal: ModalType;
  deleteBundleTarget: DeleteTarget | null;

  // Entry selection (for rewind)
  selectedEntryIds: Set<string>;

  // Edge hover
  hoveredEdgeId: string | null;

  // Actions
  openPanel: (bundleId: string, mode: "local" | "cloud") => void;
  closePanel: () => void;
  setPanelTab: (tab: "entries" | "rewinds") => void;
  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setDeleteTarget: (target: DeleteTarget | null) => void;
  toggleEntry: (entryId: string) => void;
  clearEntrySelection: () => void;
  setHoveredEdge: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedBundleId: null,
  selectedBundleMode: "cloud",
  panelTab: "entries",
  activeModal: null,
  deleteBundleTarget: null,
  selectedEntryIds: new Set(),
  hoveredEdgeId: null,

  openPanel: (bundleId, mode) =>
    set({ selectedBundleId: bundleId, selectedBundleMode: mode, panelTab: "entries" }),

  closePanel: () =>
    set({ selectedBundleId: null, selectedEntryIds: new Set() }),

  setPanelTab: (tab) => set({ panelTab: tab }),

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
