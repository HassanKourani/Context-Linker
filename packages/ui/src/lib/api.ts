import type { GraphData } from "../types";

export async function fetchGraphData(): Promise<GraphData> {
  const res = await fetch("/api/graph");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error: ${res.status}`);
  }
  return res.json();
}
