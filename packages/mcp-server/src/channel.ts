/**
 * Cross-session notification channel for bundle Q&A.
 * Each MCP server opens a local HTTP port and registers it in the active session file.
 * When a question/answer is posted, it broadcasts to other sessions on the same machine.
 */
import {
  listActiveSessions,
  loadActiveSession,
  saveActiveSession,
  type Question,
} from "@ctx-link/core";

// ---------- Types ----------

export interface ChannelMessage {
  type: "question_asked" | "question_answered" | "question_resolved";
  bundle_id: string;
  question: Question;
  from_session_id: string;
  from_project: string;
  target_project?: string;
}

// ---------- Listener ----------

export function startChannelListener(
  sessionId: string,
  onMessage: (msg: ChannelMessage) => void,
): { port: number; close: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0, // OS picks an available port
    async fetch(req) {
      if (req.method !== "POST" || new URL(req.url).pathname !== "/channel") {
        return new Response("Not found", { status: 404 });
      }
      try {
        const msg = (await req.json()) as ChannelMessage;
        // Don't process messages from self
        if (msg.from_session_id === sessionId) {
          return Response.json({ ok: true, ignored: "self" });
        }
        onMessage(msg);
        return Response.json({ ok: true });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 400 });
      }
    },
  });

  const port = server.port as number;

  // Save port to active session file
  const session = loadActiveSession(sessionId);
  if (session) {
    session.channel_port = port;
    saveActiveSession(session);
  }

  process.stderr.write(`ctx-link Q&A channel listening on port ${port}\n`);

  return {
    port,
    close: () => {
      server.stop();
      // Clear port from session file
      const s = loadActiveSession(sessionId);
      if (s) {
        s.channel_port = null;
        saveActiveSession(s);
      }
    },
  };
}

// ---------- Broadcast ----------

/**
 * Broadcast a message to all other sessions connected to the same bundle.
 * Fire-and-forget — failures are silently ignored (session may be offline).
 */
export async function broadcastToBundle(
  bundleId: string,
  message: ChannelMessage,
  excludeSessionId: string,
): Promise<{ sent: number; failed: number }> {
  const sessions = listActiveSessions();
  const targets = sessions.filter(
    (s) =>
      s.session_id !== excludeSessionId &&
      s.channel_port &&
      s.bundles.some((b) => b.bundle_id === bundleId),
  );

  let sent = 0;
  let failed = 0;

  for (const s of targets) {
    try {
      const res = await fetch(`http://127.0.0.1:${s.channel_port}/channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(2000), // 2s timeout
      });
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++; // Session offline or port stale — that's fine
    }
  }

  return { sent, failed };
}
