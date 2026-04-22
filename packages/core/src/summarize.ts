import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { loadGlobalConfig } from "./config.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const cfg = loadGlobalConfig();
  if (!cfg.anthropic_api_key) {
    throw new Error("ctx-link: anthropic_api_key not set in global config.");
  }
  client = new Anthropic({ apiKey: cfg.anthropic_api_key });
  return client;
}

// Shape we ask the model to return. Kept tight on purpose;
// this is the cross-project handoff note, not a full changelog.
export const SummaryResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  files_touched: z.array(z.string()).default([]),
  decisions: z
    .array(
      z.object({
        decision: z.string(),
        rationale: z.string().optional(),
        affects: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

export type SummaryResult = z.infer<typeof SummaryResultSchema>;

export interface SummarizeInput {
  project_name: string;
  event_type: "commit" | "pr_open" | "manual" | "session_end";
  trigger_ref?: string | null;
  raw_context: string;
  model?: string;
}

const SYSTEM_PROMPT = `You write short handoff notes between engineering projects.

You receive a git diff or snippet from one project. Another developer (or AI \
assistant) is working on a related project and needs to know what changed here \
that could affect their work.

Return ONLY valid JSON, no prose, no markdown fences. Schema:

{
  "summary": "2-4 sentences, focus on cross-project impact: API shapes, contracts, \
data formats, breaking changes. Skip internal refactors that don't affect callers.",
  "files_touched": ["path/to/file.ts", ...],
  "decisions": [
    {
      "decision": "what was decided / changed",
      "rationale": "why (optional, only if clear from context)",
      "affects": ["frontend", "mobile", "api-consumers", ...]
    }
  ]
}

Rules:
- If the change is purely internal (no external contract impact), still produce \
a summary but keep decisions empty.
- Never invent facts not visible in the provided context.
- Prefer concrete names (endpoints, functions, fields) over generic descriptions.`;

export async function summarizeContext(
  input: SummarizeInput
): Promise<SummaryResult> {
  const cfg = loadGlobalConfig();
  const model = input.model ?? "claude-sonnet-4-5";

  const userMessage = [
    `Project: ${input.project_name}`,
    `Event: ${input.event_type}${input.trigger_ref ? ` (${input.trigger_ref})` : ""}`,
    ``,
    `Context:`,
    input.raw_context.slice(0, 20_000), // hard cap to keep costs sane
  ].join("\n");

  const c = getClient();
  const res = await c.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("summarize: no text in model response");
  }

  const cleaned = textBlock.text.replace(/```(?:json)?|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `summarize: model did not return valid JSON. Raw: ${cleaned.slice(0, 200)}`
    );
  }

  return SummaryResultSchema.parse(parsed);
}
