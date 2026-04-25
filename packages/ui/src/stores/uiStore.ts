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
  | "push-to-cloud"
  | "push-to-cloud-prompt"
  | "connect-and-push"
  | "rewind"
  | "edge-action"
  | "push-bundle-to-cloud"
  | null;

type PanelView =
  | { kind: "bundle"; bundleId: string; filterProject: string | null }
  | { kind: "session"; sessionId: string; projectName: string; sessionName?: string | null }
  | { kind: "questions"; bundleId: string; bundleName: string }
  | { kind: "feed"; teamId: string; teamName: string }
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

  // Push-to-cloud target
  pushToCloudTarget: string | null;

  // Pending connect after push-to-cloud (session → cloud bundle blocked until session is in cloud)
  pendingCloudConnect: { sessionId: string; bundleId: string } | null;

  // Pending connect-and-push (drag session → bundle opens entry picker)
  pendingConnectPush: { sessionId: string; bundleId: string } | null;

  // Edge hover
  hoveredEdgeId: string | null;

  // Edge action confirmation
  pendingEdgeAction: { sessionId: string; bundleId: string; action: "push" | "unlink" } | null;

  // Push bundle to cloud target
  pushBundleToCloudTarget: { id: string; name: string } | null;

  // Graph filters
  hideEmptySessions: boolean;
  hideEmptyQuestions: boolean;

  // Actions
  openBundlePanel: (bundleId: string, filterProject?: string) => void;
  openSessionPanel: (sessionId: string, projectName: string, sessionName?: string | null) => void;
  openQuestionsPanel: (bundleId: string, bundleName: string) => void;
  openFeedPanel: (teamId: string, teamName: string) => void;
  closePanel: () => void;
  setPanelTab: (tab: "entries" | "rewinds") => void;
  setFilterProject: (project: string | null) => void;
  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setDeleteTarget: (target: DeleteTarget | null) => void;
  setPushToCloudTarget: (sessionId: string | null) => void;
  setPendingConnectPush: (target: { sessionId: string; bundleId: string } | null) => void;
  toggleEntry: (entryId: string) => void;
  clearEntrySelection: () => void;
  setHoveredEdge: (id: string | null) => void;
  setPendingEdgeAction: (action: { sessionId: string; bundleId: string; action: "push" | "unlink" } | null) => void;
  setPushBundleToCloudTarget: (target: { id: string; name: string } | null) => void;
  toggleHideEmptySessions: () => void;
  toggleHideEmptyQuestions: () => void;

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
  pushToCloudTarget: null,
  pendingCloudConnect: null,
  pendingConnectPush: null,
  selectedEntryIds: new Set(),
  hoveredEdgeId: null,
  pendingEdgeAction: null,
  pushBundleToCloudTarget: null,
  hideEmptySessions: (() => {
    try { return localStorage.getItem("ctx-link-hide-empty-sessions") === "true"; } catch { return false; }
  })(),
  hideEmptyQuestions: (() => {
    try { return localStorage.getItem("ctx-link-hide-empty-questions") === "true"; } catch { return false; }
  })(),

  selectedBundleId: null,
  filterProject: null,

  openBundlePanel: (bundleId, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, filterProject: filterProject ?? null },
      panelTab: "entries",
      selectedBundleId: bundleId,
      filterProject: filterProject ?? null,
    }),

  openSessionPanel: (sessionId, projectName, sessionName) =>
    set({
      panel: { kind: "session", sessionId, projectName, sessionName },
      panelTab: "entries",
      selectedBundleId: null,
      filterProject: null,
    }),

  openQuestionsPanel: (bundleId, bundleName) =>
    set({
      panel: { kind: "questions", bundleId, bundleName },
      panelTab: "entries",
      selectedBundleId: null,
      filterProject: null,
    }),

  openFeedPanel: (teamId, teamName) =>
    set({
      panel: { kind: "feed", teamId, teamName },
      panelTab: "entries",
      selectedBundleId: null,
      filterProject: null,
    }),

  // Legacy alias
  openPanel: (bundleId, filterProject) =>
    set({
      panel: { kind: "bundle", bundleId, filterProject: filterProject ?? null },
      panelTab: "entries",
      selectedBundleId: bundleId,
      filterProject: filterProject ?? null,
    }),

  closePanel: () =>
    set({ panel: null, selectedEntryIds: new Set(), selectedBundleId: null, filterProject: null }),

  setPanelTab: (tab) => set({ panelTab: tab }),

  setFilterProject: (project) =>
    set((state) => {
      if (state.panel?.kind !== "bundle") return {};
      return { panel: { ...state.panel, filterProject: project }, filterProject: project };
    }),

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () => set({ activeModal: null, deleteBundleTarget: null, pushToCloudTarget: null, pendingCloudConnect: null, pendingConnectPush: null, pendingEdgeAction: null, pushBundleToCloudTarget: null }),

  setDeleteTarget: (target) => set({ deleteBundleTarget: target }),

  setPushToCloudTarget: (sessionId) => set({ pushToCloudTarget: sessionId }),

  setPendingConnectPush: (target) => set({ pendingConnectPush: target }),

  toggleEntry: (entryId) =>
    set((state) => {
      const next = new Set(state.selectedEntryIds);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return { selectedEntryIds: next };
    }),

  clearEntrySelection: () => set({ selectedEntryIds: new Set() }),

  setHoveredEdge: (id) => set({ hoveredEdgeId: id }),

  setPendingEdgeAction: (action) => set({ pendingEdgeAction: action }),

  setPushBundleToCloudTarget: (target) => set({ pushBundleToCloudTarget: target }),

  toggleHideEmptySessions: () =>
    set((state) => {
      const next = !state.hideEmptySessions;
      try { localStorage.setItem("ctx-link-hide-empty-sessions", String(next)); } catch {}
      return { hideEmptySessions: next };
    }),

  toggleHideEmptyQuestions: () =>
    set((state) => {
      const next = !state.hideEmptyQuestions;
      try { localStorage.setItem("ctx-link-hide-empty-questions", String(next)); } catch {}
      return { hideEmptyQuestions: next };
    }),
}));
