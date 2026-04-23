# UI Dashboard — Developer Guide

## Overview

n8n-style node graph dashboard at `packages/ui/`. Shows all teams, bundles, projects, and sessions as interconnected nodes. Supports creating/deleting bundles, drag-to-connect projects to bundles, entry timeline viewing, manual push, rewind/restore, and team management.

## Running

```bash
# Terminal 1 — API proxy (port 5174)
bun run dev:ui-api

# Terminal 2 — Vite dev server (port 5173)
bun run dev:ui

# Open http://localhost:5173
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Bundler | Vite 6 + @tailwindcss/vite |
| Graph | @xyflow/react v12 (React Flow) |
| Layout | dagre (left-to-right hierarchical) |
| Data fetching | TanStack Query v5 (30s auto-refresh) |
| UI state | Zustand |
| Components | shadcn/ui (base-ui variant, NOT Radix) |
| Toasts | sonner |
| Theme | Tailwind CSS v4, Catppuccin Mocha dark |
| Icons | lucide-react |

## File Structure

```
packages/ui/
  server.ts              API proxy (Bun.serve, port 5174)
  vite.config.ts         Vite + Tailwind + proxy config
  src/
    main.tsx             React entry + QueryClient + Toaster
    App.tsx              React Flow canvas + modals + panels
    types.ts             All TypeScript interfaces
    stores/
      uiStore.ts         Zustand store (panels, modals, selections, hover)
    lib/
      api.ts             HTTP client (fetch wrappers for all endpoints)
      buildGraph.ts      GraphData → React Flow nodes/edges
      layout.ts          dagre wrapper
      colors.ts          team name → HSL hash
      time.ts            relative time formatting (date-fns)
      edgeHover.ts       debounced edge hover state management
      utils.ts           cn() classname merge (shadcn)
    hooks/
      useGraphData.ts    Query: GET /api/graph
      useEntries.ts      Query: GET /api/bundles/:id/entries
      useRewinds.ts      Query: GET /api/bundles/:id/rewinds
      useTeams.ts        Query: GET /api/teams
      mutations/
        useCreateBundle.ts
        useDeleteBundle.ts     (optimistic: removes bundle node)
        useJoinBundle.ts       (optimistic: adds edge)
        useDeleteSession.ts    (optimistic: removes edge)
        usePushEntry.ts        (optimistic: prepends entry)
        useRewind.ts           (optimistic: removes entries)
        useRestore.ts
        useCreateTeam.ts
        useJoinTeam.ts
    components/
      TopBar.tsx              Title, +Bundle button, Teams button, status
      EntryPanel.tsx          Side sheet: entries + rewinds tabs
      EntryCard.tsx           Single entry with expand/collapse
      EventTypeBadge.tsx      Color-coded event type chip
      CreateBundleDialog.tsx  Modal: name + mode + team
      DeleteBundleDialog.tsx  Confirmation modal
      PushEntryForm.tsx       Modal: project + summary
      RewindDialog.tsx        Modal: reason + dry-run + apply
      RewindHistoryTab.tsx    Rewind list with restore buttons
      TeamManagementDialog.tsx  Modal: list/create/join tabs
      nodes/
        ProjectNode.tsx       Session rows with draggable handles
        BundleNode.tsx        Entry count, dropdown menu, click-to-panel
        TeamGroupNode.tsx     Dashed colored container
      edges/
        DeletableEdge.tsx     Bezier edge with X delete on hover
      ui/                     shadcn/ui components (auto-generated)
```

## Component Patterns

### shadcn/ui uses base-ui, NOT Radix

This project's shadcn/ui components are built on `@base-ui/react`. Key differences from Radix:
- No `asChild` prop — use `render` prop for composition
- Dialog: `open` + `onOpenChange` props (same API)
- Checkbox: `checked` + `onCheckedChange` (same API)

### React Flow Custom Nodes

```tsx
// Node types registered in App.tsx
const nodeTypes: NodeTypes = {
  project: ProjectNode,
  bundle: BundleNode,
  teamGroup: TeamGroupNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
};
```

Node data is set in `buildGraph.ts` and accessed via `data as { ... }` cast in each component.

### Edge Interaction Gotchas

React Flow's pane layer intercepts mouse events. For interactive elements in `EdgeLabelRenderer`:
- Use `onPointerDown` instead of `onClick` (fires first)
- Set `zIndex: 1000` on the wrapper div
- Use `onEdgeMouseEnter`/`onEdgeMouseLeave` on `<ReactFlow>` for hover detection (not custom SVG paths)
- Debounce the leave timer (400ms) so the button stays visible while moving to it

### Optimistic Updates Pattern

All mutations follow:
```typescript
onMutate: async (params) => {
  await qc.cancelQueries({ queryKey });
  const prev = qc.getQueryData(queryKey);
  qc.setQueryData(queryKey, optimisticTransform);
  return { prev };
},
onError: (_err, _params, ctx) => {
  if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
  toast.error(_err.message);
},
onSettled: () => {
  qc.invalidateQueries({ queryKey });
},
```

## Graph Layout

dagre computes positions per team group (rankdir: LR):
- Project nodes: 220px wide, height = 36 + 32 per session
- Bundle nodes: 200px x 88px
- Group padding: 40px, header: 30px
- Node sep: 60px, rank sep: 120px

Groups are stacked vertically with 60px gaps. The "Local" group appears after all team groups.

## Theme

Catppuccin Mocha colors as CSS variables in `index.css`:

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | #11111b | Canvas background |
| `--card` | #1e1e2e | Node backgrounds |
| `--border` | #313244 | Borders |
| `--foreground` | #cdd6f4 | Primary text |
| `--muted-foreground` | #a6adc8 | Secondary text |
| `--primary` | #89b4fa | Blue accent |
| `--destructive` | #f38ba8 | Red/delete |

Use semantic classes (`bg-card`, `text-foreground`, `border-border`) not raw hex values.
