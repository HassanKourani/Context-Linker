# ctx-link UI: Node Graph Dashboard

## Overview

A read-only node graph dashboard for ctx-link, built in the style of n8n. Users see all their teams, bundles, projects, and sessions as an interconnected graph on a pannable, zoomable canvas. No write actions in this first iteration — purely visual.

## Graph Structure

The canvas displays a single unified graph of everything the current machine has access to.

### Node types

**TeamGroupNode** — a container that wraps all bundles and projects belonging to one team. Rendered as a rounded bordered region with the team name as a label and a tinted background (team name hashed to an HSL color). A "Local" group uses the same treatment with a neutral gray tint for local-mode bundles.

**ProjectNode** — a card-style node. Header shows the project name. Body lists one row per session in that project. Each session row displays:
- Machine ID (truncated, monospace)
- "You" badge (highlighted) if the machine ID matches the current machine
- Last active time (relative, e.g. "2m ago")
- A source handle on the right side of the row

**BundleNode** — a card-style node. Header shows the bundle name. Body displays:
- Entry count
- Last activity (relative time)
- A single target handle on the left side

### Edges

Edges connect each session's source handle (right side of the session row inside a ProjectNode) to the target handle of the BundleNode that session belongs to. Edges are styled as smooth bezier curves with a subtle animated dash to convey "data flows here."

### Layout

Dagre auto-layout, left-to-right (rankdir: LR) within each team group. Project nodes on the left, bundle nodes on the right. Multiple team groups stack vertically on the canvas. The "Local" group appears below all team groups.

```
╔══ Team Alpha ══════════════════════════════════════╗
║                                                    ║
║  ┌────────────────┐          ┌─────────────────┐   ║
║  │  frontend      │          │  feature-xyz    │   ║
║  │────────────────│          │  12 entries     │   ║
║  │ abc12 (You) 2m │─────────→│  2m ago         │   ║
║  │ def34      1h  │────┐     └─────────────────┘   ║
║  └────────────────┘    │                           ║
║                        │     ┌─────────────────┐   ║
║  ┌────────────────┐    │     │  api-refactor   │   ║
║  │  backend       │    └────→│  5 entries      │   ║
║  │────────────────│          │  1h ago         │   ║
║  │ abc12 (You) 5m │─────────→│                 │   ║
║  └────────────────┘          └─────────────────┘   ║
║                                                    ║
╚════════════════════════════════════════════════════╝

╔══ Local ═══════════════════════════════════════════╗
║                                                    ║
║  ┌────────────────┐          ┌─────────────────┐   ║
║  │  my-app        │          │  local-test     │   ║
║  │────────────────│          │  3 entries      │   ║
║  │ abc12 (You) 1d │─────────→│  1d ago         │   ║
║  └────────────────┘          └─────────────────┘   ║
║                                                    ║
╚════════════════════════════════════════════════════╝
```

## Tech Stack

| Concern | Choice | Reason |
|---------|--------|--------|
| Framework | React 19 + TypeScript | Matches React Flow requirement |
| Bundler | Vite | Fast, standard for React SPAs |
| Graph | React Flow (@xyflow/react) | What n8n uses. Handles nodes, edges, zoom, pan, grouping, handles |
| Auto-layout | dagre | Standard graph layout lib, pairs with React Flow |
| Styling | Tailwind CSS + shadcn/ui | Consistent with planned design system |
| Data fetching | TanStack Query (@tanstack/react-query) | Caching, auto-refresh, loading states |
| Data access | Local API proxy (Bun.serve) | All data (cloud + local) served via localhost proxy using core functions |
| Date formatting | date-fns | Relative time display |

## Package Structure

```
packages/ui/
  package.json          # @ctx-link/ui, workspace dep on @ctx-link/core
  tsconfig.json
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  index.html
  src/
    main.tsx            # React entry, QueryClientProvider
    App.tsx             # Canvas + top bar
    components/
      nodes/
        ProjectNode.tsx   # Custom React Flow node
        BundleNode.tsx    # Custom React Flow node
        TeamGroup.tsx     # Group node wrapper
      TopBar.tsx          # Title, machine ID, refresh indicator
    hooks/
      useGraphData.ts     # Orchestrates all queries, builds React Flow nodes/edges
      useMyTeams.ts       # Fetch teams for current machine
      useBundlesByTeam.ts # Fetch bundles in a team
      useSessionsByBundle.ts # Fetch sessions in a bundle
      useBundleStatus.ts  # Fetch entry count + last activity
      useLocalBundles.ts  # Fetch from local API proxy
      useMachineId.ts     # Get current machine_id
    lib/
      api.ts              # Fetch wrapper for local API proxy (localhost:5174)
      layout.ts           # Dagre layout computation
      colors.ts           # Team name → HSL hash
    types.ts              # Shared UI types
  components.json         # shadcn/ui config

```

The local API proxy lives as a single file in the ui package:

```
packages/ui/
  server.ts             # Bun.serve local API proxy, runs alongside Vite
```

Root `package.json` gains:
```json
"dev:ui": "bun run --cwd packages/ui dev",
"dev:ui-api": "bun packages/ui/server.ts"
```

## Data Access

All data (cloud and local) is served through a local API proxy at `localhost:5174`. The browser never talks to Supabase directly — the proxy imports `@ctx-link/core` and calls the existing functions using the service_role client, filtering by machine_id server-side. This avoids needing RLS policies or exposing the anon key.

### Local API Proxy

```
GET /api/config           → { machine_id }
GET /api/teams            → TeamInfo[]
GET /api/bundles          → { team_id, bundles: BundleStatus[] }[]  (cloud)
GET /api/local/bundles    → BundleStatus[]  (local)
GET /api/bundles/:id/sessions → SessionRow[]
GET /api/local/bundles/:id/sessions → SessionRow[] (from local store)
```

The proxy imports from `@ctx-link/core` and calls the existing functions. No new logic — just HTTP wrappers.

## Layout Algorithm

1. Fetch all data (teams, bundles, sessions, local bundles)
2. For each team, create a parent group node
3. Within each team group, create ProjectNodes and BundleNodes
4. Create edges from each session handle to its bundle
5. Run dagre layout (rankdir: LR) per group to position nodes
6. Offset each group vertically so they stack without overlap
7. Pass nodes + edges to React Flow

## Top Bar

Fixed bar above the canvas:
- Left: "ctx-link" title
- Center: empty (room for future search)
- Right: machine ID badge (monospace, truncated), auto-refresh indicator (green dot pulsing when data is fresh, shows last refresh time)

## Styling

- Dark mode by default (matches terminal aesthetic, n8n's dark mode)
- Node cards: rounded corners, subtle border, dark card background (#1a1a2e or similar)
- Team groups: dashed border, semi-transparent tinted background
- Edges: gray bezier curves, animated dash pattern
- "You" badge: green accent
- Monospace for IDs, SHAs, machine IDs
- Relative times refresh every 30 seconds (via TanStack Query refetchInterval)

## Future Extensibility

This design explicitly supports future additions:
- **Drag-to-connect**: React Flow's onConnect callback. Drag from a new session handle to a bundle node → calls `joinBundle`.
- **Click node for details**: onClick handler on BundleNode opens a side panel with entry timeline.
- **Rewind/restore UI**: context menu on nodes.
- **Create bundle**: toolbar button that adds a new BundleNode, user names it and drags connections.
- **Manual push**: right-click on a session → "Push manual entry."

None of these are in scope for this iteration. The graph is read-only.

## What's NOT in scope

- Any write operations (create, join, push, rewind, restore, delete)
- Entry timeline / detail views
- Search
- Authentication beyond machine_id
- Deployment / hosting
- Mobile / responsive (desktop canvas only)
- RLS policies (proxy handles access)
