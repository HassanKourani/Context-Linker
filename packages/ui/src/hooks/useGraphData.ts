import { useQuery } from "@tanstack/react-query";
import { fetchGraphData } from "../lib/api";
import type { GraphData } from "../types";

export function useGraphData(enabled: boolean = true) {
  return useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: fetchGraphData,
    enabled,
  });
}
