# UI Node Graph Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only n8n-style node graph dashboard that visualizes teams, bundles, projects, and sessions as interconnected nodes on a pannable/zoomable canvas.

**Architecture:** Single-page React app in `packages/ui/`. A local Bun API proxy (`server.ts`) serves all data by calling `@ctx-link/core` functions. React Flow renders custom nodes (ProjectNode, BundleNode, TeamGroupNode) with dagre auto-layout. TanStack Query handles fetching + auto-refresh.

**Tech Stack:** React 19, Vite, @xyflow/react (React Flow v12), dagre, TanStack Query, Tailwind CSS v4, date-fns, Bun.serve

---

## Task 1: Scaffold packages/ui

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/index.html`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/App.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@ctx-link/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "serve": "bun server.ts"
  },
  "dependencies": {
    "@ctx-link/core": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "@xyflow/react": "^12.0.0",
    "dagre": "^0.8.5",
    "date-fns": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/dagre": "^0.7.52",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0"
  }
}
```

Note: `@ctx-link/core` is listed for `server.ts` (runs in Bun, not Vite). The browser code never imports from core.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`server.ts` is outside `src/` — Bun runs it directly, no Vite/tsc needed.

- [ ] **Step 3: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ctx-link</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:5174",
    },
  },
});
```

The proxy forwards `/api/*` requests from Vite dev server (port 5173) to the Bun API server (port 5174).

- [ ] **Step 5: Create src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 6: Create src/App.tsx placeholder**

```tsx
export function App() {
  return (
    <div className="h-screen w-screen bg-[#11111b] text-[#cdd6f4]">
      <p className="p-8">ctx-link UI loading...</p>
    </div>
  );
}
```

- [ ] **Step 7: Create src/index.css**

```css
@import "tailwindcss";
@import "@xyflow/react/dist/style.css";

body {
  margin: 0;
  background: #11111b;
}

.react-flow__handle {
  width: 8px !important;
  height: 8px !important;
  background: #585b70 !important;
  border: 2px solid #313244 !important;
  min-width: 0 !important;
  min-height: 0 !important;
}
```

- [ ] **Step 8: Install dependencies and verify**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && bun install`
Expected: all workspace deps resolve, no errors.

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link/packages/ui && bunx vite --host 2>&1 | head -5`
Expected: Vite dev server starts on port 5173.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/package.json packages/ui/tsconfig.json packages/ui/index.html packages/ui/vite.config.ts packages/ui/src/main.tsx packages/ui/src/App.tsx packages/ui/src/index.css bun.lock
git commit -m "feat(ui): scaffold packages/ui with Vite + React + Tailwind"
```

---

## Task 2: Add core data functions

**Files:**
- Modify: `packages/core/src/bundles.ts` (add `listBundleSessions`)
- Modify: `packages/core/src/local-store.ts` (add `listAllLocalBundleDetails`)
- Modify: `packages/core/src/index.ts` (already re-exports, no change needed)

- [ ] **Step 1: Add listBundleSessions to bundles.ts**

Add at the end of `packages/core/src/bundles.ts`:

```typescript
export interface SessionInfo {
  session_id: string;
  project_name: string;
  machine_id: string;
  last_active_at: string | null;
}

export async function listBundleSessions(
  bundleId: string
): Promise<SessionInfo[]> {
  await assertTokenValid(bundleId);
  const sb = getSupabase();

  const { data, error } = await sb
    .from("sessions")
    .select("id, project_name, machine_id, last_active_at")
    .eq("bundle_id", bundleId)
    .order("last_active_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`listBundleSessions failed: ${error.message}`);

  return (data ?? []).map((s: any) => ({
    session_id: s.id,
    project_name: s.project_name,
    machine_id: s.machine_id,
    last_active_at: s.last_active_at,
  }));
}
```

- [ ] **Step 2: Add listAllLocalBundleDetails to local-store.ts**

Add `readdirSync` to the existing import from `node:fs` at the top of `packages/core/src/local-store.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
```

Then add at the end of the file:

```typescript
export interface LocalBundleDetail {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  projects: Array<{
    project_name: string;
    last_entry_at: string | null;
  }>;
}

export function listAllLocalBundleDetails(): LocalBundleDetail[] {
  const dir = localDir();
  if (!existsSync(dir)) return [];

  const bundleIds = readdirSync(dir).filter((name) =>
    existsSync(join(dir, name, "meta.json"))
  );

  return bundleIds.map((id) => {
    const meta = readMeta(id);
    const entries = readEntries(id).filter((e) => !e.superseded_at);
    const sorted = entries.sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );

    const projectMap = new Map<string, string>();
    for (const entry of sorted) {
      if (!projectMap.has(entry.project_name)) {
        projectMap.set(entry.project_name, entry.created_at);
      }
    }

    return {
      bundle_id: meta.id,
      bundle_name: meta.name,
      entry_count: entries.length,
      last_entry_at: sorted[0]?.created_at ?? null,
      projects: Array.from(projectMap.entries()).map(([name, lastAt]) => ({
        project_name: name,
        last_entry_at: lastAt,
      })),
    };
  });
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/bundles.ts packages/core/src/local-store.ts
git commit -m "feat(core): add listBundleSessions and listAllLocalBundleDetails for UI"
```

---

## Task 3: Build API proxy

**Files:**
- Create: `packages/ui/server.ts`

- [ ] **Step 1: Create server.ts**

```typescript
import {
  loadGlobalConfig,
  listMyTeams,
  listBundleSessions,
  listAllLocalBundleDetails,
} from "@ctx-link/core";
import { listTeamBundles } from "@ctx-link/core";
import { bundleStatus } from "@ctx-link/core";

const server = Bun.serve({
  port: 5174,
  async fetch(req) {
    const url = new URL(req.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/graph") {
      try {
        const config = loadGlobalConfig();
        const teams = listMyTeams();

        const teamData = await Promise.all(
          teams.map(async (team) => {
            const bundles = await listTeamBundles(team.team_id);
            const bundlesWithDetails = await Promise.all(
              bundles.map(async (b) => {
                const [status, sessions] = await Promise.all([
                  bundleStatus(b.bundle_id, "cloud"),
                  listBundleSessions(b.bundle_id),
                ]);
                return {
                  bundle_id: b.bundle_id,
                  bundle_name: b.name,
                  entry_count: status.entry_count,
                  last_entry_at: status.last_entry_at,
                  sessions: sessions.map((s) => ({
                    session_id: s.session_id,
                    project_name: s.project_name,
                    machine_id: s.machine_id,
                    last_active_at: s.last_active_at,
                  })),
                };
              })
            );
            return {
              team_id: team.team_id,
              team_name: team.name,
              bundles: bundlesWithDetails,
            };
          })
        );

        const localBundles = listAllLocalBundleDetails();

        return Response.json(
          {
            machine_id: config.machine_id,
            teams: teamData,
            local: { bundles: localBundles },
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json(
          { error: err.message ?? String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`ctx-link UI API running at http://localhost:${server.port}`);
```

- [ ] **Step 2: Test the proxy starts**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && timeout 3 bun packages/ui/server.ts 2>&1 || true`
Expected: prints "ctx-link UI API running at http://localhost:5174" (may timeout after — that's fine).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/server.ts
git commit -m "feat(ui): add API proxy server for graph data"
```

---

## Task 4: UI types and API client

**Files:**
- Create: `packages/ui/src/types.ts`
- Create: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Create src/types.ts**

These types mirror the API response shape. Defined here (not imported from core) to keep the browser bundle free of Node.js dependencies.

```typescript
export interface GraphData {
  machine_id: string;
  teams: TeamGraphData[];
  local: { bundles: LocalBundleGraphData[] };
}

export interface TeamGraphData {
  team_id: string;
  team_name: string;
  bundles: BundleGraphData[];
}

export interface BundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  sessions: SessionGraphData[];
}

export interface SessionGraphData {
  session_id: string;
  project_name: string;
  machine_id: string;
  last_active_at: string | null;
}

export interface LocalBundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  projects: Array<{
    project_name: string;
    last_entry_at: string | null;
  }>;
}
```

- [ ] **Step 2: Create src/lib/api.ts**

```typescript
import type { GraphData } from "../types";

export async function fetchGraphData(): Promise<GraphData> {
  const res = await fetch("/api/graph");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/types.ts packages/ui/src/lib/api.ts
git commit -m "feat(ui): add graph data types and API client"
```

---

## Task 5: Data hook

**Files:**
- Create: `packages/ui/src/hooks/useGraphData.ts`

- [ ] **Step 1: Create useGraphData hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { fetchGraphData } from "../lib/api";
import type { GraphData } from "../types";

export function useGraphData() {
  return useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: fetchGraphData,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/useGraphData.ts
git commit -m "feat(ui): add useGraphData hook"
```

---

## Task 6: Layout engine and color utility

**Files:**
- Create: `packages/ui/src/lib/colors.ts`
- Create: `packages/ui/src/lib/layout.ts`

- [ ] **Step 1: Create src/lib/colors.ts**

```typescript
export function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

export const LOCAL_GROUP_COLOR = "hsl(240, 7%, 40%)";
```

- [ ] **Step 2: Create src/lib/layout.ts**

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/colors.ts packages/ui/src/lib/layout.ts
git commit -m "feat(ui): add dagre layout engine and color hash utility"
```

---

## Task 7: Graph builder

**Files:**
- Create: `packages/ui/src/lib/buildGraph.ts`
- Create: `packages/ui/src/lib/time.ts`

- [ ] **Step 1: Create src/lib/time.ts**

```typescript
import { formatDistanceToNowStrict } from "date-fns";

export function relativeTime(date: string | null): string {
  if (!date) return "never";
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}
```

- [ ] **Step 2: Create src/lib/buildGraph.ts**

This is the core transformation: `GraphData` -> React Flow `Node[]` + `Edge[]`.

```typescript
import type { Node, Edge } from "@xyflow/react";
import type { GraphData, BundleGraphData, SessionGraphData } from "../types";
import { computeLayout, type LayoutNode, type LayoutEdge } from "./layout";
import { teamColor, LOCAL_GROUP_COLOR } from "./colors";

const PROJECT_NODE_WIDTH = 220;
const PROJECT_NODE_HEADER = 36;
const PROJECT_NODE_ROW = 32;
const BUNDLE_NODE_WIDTH = 200;
const BUNDLE_NODE_HEIGHT = 88;
const GROUP_PADDING = 40;
const GROUP_HEADER = 30;
const GROUP_GAP = 60;

function projectNodeHeight(sessionCount: number): number {
  return PROJECT_NODE_HEADER + Math.max(sessionCount, 1) * PROJECT_NODE_ROW + 8;
}

interface GroupInput {
  groupId: string;
  groupName: string;
  color: string;
  bundles: BundleGraphData[];
  machineId: string;
  isLocal: boolean;
}

function buildGroup(input: GroupInput): { nodes: Node[]; edges: Edge[] } {
  const { groupId, groupName, color, bundles, machineId, isLocal } = input;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all unique projects across bundles
  const projectSessions = new Map<
    string,
    Array<{ sessionId: string; machineId: string; lastActiveAt: string | null; bundleId: string }>
  >();

  for (const bundle of bundles) {
    if (isLocal) {
      // Local bundles: synthesize sessions from projects
      for (const proj of (bundle as any).projects ?? []) {
        const key = proj.project_name;
        if (!projectSessions.has(key)) projectSessions.set(key, []);
        projectSessions.get(key)!.push({
          sessionId: `local-${bundle.bundle_id}-${proj.project_name}`,
          machineId: machineId,
          lastActiveAt: proj.last_entry_at,
          bundleId: bundle.bundle_id,
        });
      }
    } else {
      for (const session of bundle.sessions) {
        const key = session.project_name;
        if (!projectSessions.has(key)) projectSessions.set(key, []);
        projectSessions.get(key)!.push({
          sessionId: session.session_id,
          machineId: session.machine_id,
          lastActiveAt: session.last_active_at,
          bundleId: bundle.bundle_id,
        });
      }
    }
  }

  // Build layout nodes
  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  // Project nodes
  for (const [projectName, sessions] of projectSessions) {
    const nodeId = `project-${groupId}-${projectName}`;
    layoutNodes.push({
      id: nodeId,
      width: PROJECT_NODE_WIDTH,
      height: projectNodeHeight(sessions.length),
    });

    for (const s of sessions) {
      layoutEdges.push({
        source: nodeId,
        target: `bundle-${s.bundleId}`,
      });
    }
  }

  // Bundle nodes
  for (const bundle of bundles) {
    layoutNodes.push({
      id: `bundle-${bundle.bundle_id}`,
      width: BUNDLE_NODE_WIDTH,
      height: BUNDLE_NODE_HEIGHT,
    });
  }

  if (layoutNodes.length === 0) return { nodes, edges };

  // Compute layout
  const layout = computeLayout(layoutNodes, layoutEdges);

  // Group node dimensions
  const groupWidth = layout.graphWidth + GROUP_PADDING * 2;
  const groupHeight = layout.graphHeight + GROUP_PADDING * 2 + GROUP_HEADER;

  // Group node
  nodes.push({
    id: groupId,
    type: "teamGroup",
    position: { x: 0, y: 0 }, // positioned later by caller
    data: { teamName: groupName, color },
    style: { width: groupWidth, height: groupHeight },
  });

  // Project nodes (children of group)
  for (const [projectName, sessions] of projectSessions) {
    const nodeId = `project-${groupId}-${projectName}`;
    const pos = layout.positions.get(nodeId)!;

    nodes.push({
      id: nodeId,
      type: "project",
      position: { x: pos.x + GROUP_PADDING, y: pos.y + GROUP_PADDING + GROUP_HEADER },
      parentId: groupId,
      extent: "parent" as const,
      data: {
        projectName,
        sessions: sessions.map((s) => ({
          id: s.sessionId,
          machineId: s.machineId,
          lastActiveAt: s.lastActiveAt,
          isYou: s.machineId === machineId,
        })),
      },
    });
  }

  // Bundle nodes (children of group)
  for (const bundle of bundles) {
    const nodeId = `bundle-${bundle.bundle_id}`;
    const pos = layout.positions.get(nodeId)!;

    nodes.push({
      id: nodeId,
      type: "bundle",
      position: { x: pos.x + GROUP_PADDING, y: pos.y + GROUP_PADDING + GROUP_HEADER },
      parentId: groupId,
      extent: "parent" as const,
      data: {
        bundleName: bundle.bundle_name,
        entryCount: bundle.entry_count,
        lastEntryAt: bundle.last_entry_at,
      },
    });
  }

  // Edges
  for (const [projectName, sessions] of projectSessions) {
    for (const s of sessions) {
      edges.push({
        id: `edge-${s.sessionId}`,
        source: `project-${groupId}-${projectName}`,
        sourceHandle: s.sessionId,
        target: `bundle-${s.bundleId}`,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#585b70", strokeWidth: 2 },
      });
    }
  }

  return { nodes, edges };
}

export function buildFlowGraph(
  data: GraphData
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  let yOffset = 0;

  // Team groups
  for (const team of data.teams) {
    const { nodes, edges } = buildGroup({
      groupId: `team-${team.team_id}`,
      groupName: team.team_name,
      color: teamColor(team.team_name),
      bundles: team.bundles,
      machineId: data.machine_id,
      isLocal: false,
    });

    // Offset group position
    const groupNode = nodes.find((n) => n.id === `team-${team.team_id}`);
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
      const h = (groupNode.style as any)?.height ?? 200;
      yOffset += h + GROUP_GAP;
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  // Local group
  if (data.local.bundles.length > 0) {
    const { nodes, edges } = buildGroup({
      groupId: "local",
      groupName: "Local",
      color: LOCAL_GROUP_COLOR,
      bundles: data.local.bundles as any,
      machineId: data.machine_id,
      isLocal: true,
    });

    const groupNode = nodes.find((n) => n.id === "local");
    if (groupNode) {
      groupNode.position = { x: 0, y: yOffset };
    }

    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  return { nodes: allNodes, edges: allEdges };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/buildGraph.ts packages/ui/src/lib/time.ts
git commit -m "feat(ui): add graph builder — transforms API data to React Flow nodes/edges"
```

---

## Task 8: Custom React Flow nodes

**Files:**
- Create: `packages/ui/src/components/nodes/ProjectNode.tsx`
- Create: `packages/ui/src/components/nodes/BundleNode.tsx`
- Create: `packages/ui/src/components/nodes/TeamGroupNode.tsx`

- [ ] **Step 1: Create ProjectNode.tsx**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "../../lib/time";

interface SessionData {
  id: string;
  machineId: string;
  lastActiveAt: string | null;
  isYou: boolean;
}

export function ProjectNode({ data }: NodeProps) {
  const { projectName, sessions } = data as {
    projectName: string;
    sessions: SessionData[];
  };

  return (
    <div className="bg-[#1e1e2e] border border-[#313244] rounded-lg min-w-[200px] shadow-lg">
      <div className="px-3 py-2 border-b border-[#313244] font-semibold text-sm text-[#cdd6f4]">
        {projectName}
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="px-3 py-1.5 flex items-center gap-2 text-xs text-[#a6adc8] relative"
        >
          <span className="font-mono text-[11px]">
            {s.machineId.slice(0, 8)}
          </span>
          {s.isYou && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1]">
              You
            </span>
          )}
          <span className="ml-auto text-[#585b70] text-[10px]">
            {relativeTime(s.lastActiveAt)}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={s.id}
            className="!w-2 !h-2 !bg-[#585b70] !border-[#313244]"
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create BundleNode.tsx**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { relativeTime } from "../../lib/time";

export function BundleNode({ data }: NodeProps) {
  const { bundleName, entryCount, lastEntryAt } = data as {
    bundleName: string;
    entryCount: number;
    lastEntryAt: string | null;
  };

  return (
    <div className="bg-[#1e1e2e] border border-[#313244] rounded-lg min-w-[180px] shadow-lg">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#585b70] !border-[#313244]"
      />
      <div className="px-3 py-2 border-b border-[#313244] font-semibold text-sm text-[#cdd6f4]">
        {bundleName}
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="text-xs text-[#a6adc8]">
          <span className="text-[#cdd6f4] font-medium">{entryCount}</span>{" "}
          entries
        </div>
        <div className="text-[10px] text-[#585b70]">
          {relativeTime(lastEntryAt)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create TeamGroupNode.tsx**

```tsx
import type { NodeProps } from "@xyflow/react";

export function TeamGroupNode({ data }: NodeProps) {
  const { teamName, color } = data as { teamName: string; color: string };

  return (
    <div
      className="w-full h-full rounded-xl border-2 border-dashed relative"
      style={{
        borderColor: color,
        backgroundColor: color.replace(")", ", 0.05)").replace("hsl", "hsla"),
      }}
    >
      <span
        className="absolute -top-3 left-4 px-2 text-xs font-bold tracking-wide uppercase"
        style={{ color, backgroundColor: "#11111b" }}
      >
        {teamName}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/nodes/ProjectNode.tsx packages/ui/src/components/nodes/BundleNode.tsx packages/ui/src/components/nodes/TeamGroupNode.tsx
git commit -m "feat(ui): add custom React Flow nodes — Project, Bundle, TeamGroup"
```

---

## Task 9: TopBar, App assembly, and root scripts

**Files:**
- Create: `packages/ui/src/components/TopBar.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/main.tsx` (no change needed — already set up)
- Modify: `/packages/ui/package.json` (no change needed)
- Modify: root `package.json` (add scripts)

- [ ] **Step 1: Create src/components/TopBar.tsx**

```tsx
interface TopBarProps {
  machineId: string | undefined;
  isLoading: boolean;
  dataUpdatedAt: number;
}

export function TopBar({ machineId, isLoading, dataUpdatedAt }: TopBarProps) {
  const lastRefresh = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : "—";

  return (
    <div className="h-12 bg-[#181825] border-b border-[#313244] flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-[#cdd6f4] tracking-wide">
          ctx-link
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-[#585b70]">
          <span
            className={`w-2 h-2 rounded-full ${isLoading ? "bg-[#f9e2af] animate-pulse" : "bg-[#a6e3a1]"}`}
          />
          <span>{lastRefresh}</span>
        </div>
        {machineId && (
          <span className="font-mono text-xs text-[#a6adc8] bg-[#1e1e2e] px-2 py-1 rounded">
            {machineId.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire App.tsx**

Replace the placeholder `packages/ui/src/App.tsx` with:

```tsx
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
} from "@xyflow/react";
import { useGraphData } from "./hooks/useGraphData";
import { buildFlowGraph } from "./lib/buildGraph";
import { ProjectNode } from "./components/nodes/ProjectNode";
import { BundleNode } from "./components/nodes/BundleNode";
import { TeamGroupNode } from "./components/nodes/TeamGroupNode";
import { TopBar } from "./components/TopBar";

const nodeTypes: NodeTypes = {
  project: ProjectNode,
  bundle: BundleNode,
  teamGroup: TeamGroupNode,
};

export function App() {
  const { data, isLoading, dataUpdatedAt } = useGraphData();

  const { nodes, edges } = useMemo(
    () => (data ? buildFlowGraph(data) : { nodes: [], edges: [] }),
    [data]
  );

  return (
    <div className="h-screen w-screen bg-[#11111b] text-[#cdd6f4] flex flex-col">
      <TopBar
        machineId={data?.machine_id}
        isLoading={isLoading}
        dataUpdatedAt={dataUpdatedAt}
      />
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#313244" gap={20} size={1} />
          <Controls
            showInteractive={false}
            className="!bg-[#1e1e2e] !border-[#313244] !shadow-lg [&>button]:!bg-[#1e1e2e] [&>button]:!border-[#313244] [&>button]:!fill-[#cdd6f4] [&>button:hover]:!bg-[#313244]"
          />
          <MiniMap
            nodeColor="#313244"
            maskColor="rgba(17, 17, 27, 0.8)"
            className="!bg-[#181825] !border-[#313244]"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add root scripts**

Add to root `package.json` scripts:

```json
"dev:ui": "bun run --cwd packages/ui dev",
"dev:ui-api": "bun packages/ui/server.ts"
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && bun run typecheck`
Expected: no errors across all packages.

- [ ] **Step 5: Verify in browser**

Terminal 1: `bun run dev:ui-api`
Terminal 2: `bun run dev:ui`

Open http://localhost:5173 in browser. Expected:
- Dark canvas background with dot grid
- TopBar showing "ctx-link" and machine ID
- If teams/bundles exist: group containers with project and bundle nodes connected by animated edges
- If no data: empty canvas with controls and minimap visible
- Zoom/pan works

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/TopBar.tsx packages/ui/src/App.tsx package.json
git commit -m "feat(ui): wire App with React Flow canvas, TopBar, and root scripts"
```
