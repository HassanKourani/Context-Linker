import { getSupabase } from "./supabase.js";

export type FeedEventType =
  | "entry_pushed"
  | "session_connected"
  | "session_disconnected"
  | "bundle_created"
  | "bundle_deleted";

export interface FeedEvent {
  id: string;
  team_id: string;
  event_type: FeedEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Write a feed event to the team activity feed.
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function writeFeedEvent(
  teamId: string,
  eventType: FeedEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const sb = getSupabase();
    await sb
      .from("team_activity_feed")
      .insert({ team_id: teamId, event_type: eventType, payload });
  } catch {
    // Non-fatal — feed is informational, not critical
  }
}

/**
 * Read feed events for a team, paginated newest-first.
 */
export async function readFeedEvents(
  teamId: string,
  options?: { limit?: number; offset?: number },
): Promise<FeedEvent[]> {
  const sb = getSupabase();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const { data, error } = await sb
    .from("team_activity_feed")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`readFeedEvents failed: ${error.message}`);
  return (data ?? []) as FeedEvent[];
}
