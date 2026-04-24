/**
 * Bundle Q&A — questions and answers attached to bundles.
 * Currently local-only (stored in ~/.ctx-link/local/<bundle_id>/questions.json).
 * Designed cloud-ready: UUIDs, ISO timestamps, mode parameter on all functions.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { globalConfigDir } from "./config.js";
import { isLocalBundle } from "./local-store.js";

// ---------- Types ----------

export interface Answer {
  id: string;
  question_id: string;
  answered_by_session_id: string;
  answered_by_project: string;
  answer: string;
  created_at: string;
}

export interface Question {
  id: string;
  bundle_id: string;
  asked_by_session_id: string;
  asked_by_project: string;
  target_project: string | null;
  question: string;
  context: string | null;
  status: "open" | "answered" | "resolved";
  created_at: string;
  answers: Answer[];
}

// ---------- Paths ----------

function questionsPath(bundleId: string): string {
  return join(globalConfigDir(), "local", bundleId, "questions.json");
}

// ---------- Storage helpers ----------

export function readQuestions(bundleId: string): Question[] {
  const path = questionsPath(bundleId);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeQuestions(bundleId: string, questions: Question[]): void {
  const dir = join(globalConfigDir(), "local", bundleId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(questionsPath(bundleId), JSON.stringify(questions, null, 2));
}

// ---------- Functions ----------

function assertLocal(bundleId: string): void {
  if (!isLocalBundle(bundleId)) {
    throw new Error("Cloud Q&A not yet supported. Only local bundles support questions.");
  }
}

export function askQuestion(
  bundleId: string,
  sessionId: string,
  projectName: string,
  question: string,
  opts: { targetProject?: string; context?: string; mode?: "local" | "cloud" } = {},
): Question {
  assertLocal(bundleId);

  const questions = readQuestions(bundleId);
  const newQuestion: Question = {
    id: randomUUID(),
    bundle_id: bundleId,
    asked_by_session_id: sessionId,
    asked_by_project: projectName,
    target_project: opts.targetProject ?? null,
    question,
    context: opts.context ?? null,
    status: "open",
    created_at: new Date().toISOString(),
    answers: [],
  };
  questions.push(newQuestion);
  writeQuestions(bundleId, questions);
  return newQuestion;
}

export function answerQuestion(
  bundleId: string,
  questionId: string,
  sessionId: string,
  projectName: string,
  answer: string,
  opts: { mode?: "local" | "cloud" } = {},
): Answer {
  assertLocal(bundleId);

  const questions = readQuestions(bundleId);
  const q = questions.find((q) => q.id === questionId);
  if (!q) throw new Error(`Question ${questionId} not found in bundle ${bundleId}.`);

  const newAnswer: Answer = {
    id: randomUUID(),
    question_id: questionId,
    answered_by_session_id: sessionId,
    answered_by_project: projectName,
    answer,
    created_at: new Date().toISOString(),
  };
  q.answers.push(newAnswer);
  q.status = "answered";
  writeQuestions(bundleId, questions);
  return newAnswer;
}

export function resolveQuestion(
  bundleId: string,
  questionId: string,
  opts: { mode?: "local" | "cloud" } = {},
): void {
  assertLocal(bundleId);

  const questions = readQuestions(bundleId);
  const q = questions.find((q) => q.id === questionId);
  if (!q) throw new Error(`Question ${questionId} not found in bundle ${bundleId}.`);

  q.status = "resolved";
  writeQuestions(bundleId, questions);
}

export function listBundleQuestions(
  bundleId: string,
  opts: { status?: "open" | "answered" | "resolved"; targetProject?: string; mode?: "local" | "cloud" } = {},
): Question[] {
  assertLocal(bundleId);

  let questions = readQuestions(bundleId);
  if (opts.status) {
    questions = questions.filter((q) => q.status === opts.status);
  }
  if (opts.targetProject) {
    questions = questions.filter((q) => q.target_project === opts.targetProject || q.target_project === null);
  }
  return questions.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getQuestion(
  bundleId: string,
  questionId: string,
  opts: { mode?: "local" | "cloud" } = {},
): Question {
  assertLocal(bundleId);

  const questions = readQuestions(bundleId);
  const q = questions.find((q) => q.id === questionId);
  if (!q) throw new Error(`Question ${questionId} not found in bundle ${bundleId}.`);
  return q;
}

/** Count open questions for a bundle. Returns 0 if not a local bundle or no questions file. */
export function countOpenQuestions(bundleId: string): number {
  if (!isLocalBundle(bundleId)) return 0;
  const questions = readQuestions(bundleId);
  return questions.filter((q) => q.status === "open").length;
}
