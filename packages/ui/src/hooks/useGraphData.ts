import { useQuery } from "@tanstack/react-query";
import { fetchGraphData } from "../lib/api";
import type { GraphData } from "../types";

export function useGraphData() {
  return useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: fetchGraphData,
  });
}
