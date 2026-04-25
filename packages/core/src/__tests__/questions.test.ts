import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import {
  readQuestions,
  askQuestion,
  answerQuestion,
  resolveQuestion,
  listBundleQuestions,
  getQuestion,
  countOpenQuestions,
} from "../questions.js";
import { localCreateBundle } from "../local-store.js";
import { randomUUID } from "node:crypto";

let testDir: string;
let bundleId: string;

beforeEach(() => {
  testDir = setupTestDir();
  // Create a local bundle so isLocalBundle() returns true and the directory exists
  const result = localCreateBundle("test-bundle");
  bundleId = result.bundle_id;
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ── readQuestions ────────────────────────────────────────────────────────────

describe("readQuestions", () => {
  test("returns empty array for a bundle with no questions", () => {
    const questions = readQuestions(bundleId);
    expect(questions).toEqual([]);
  });

  test("returns empty array for nonexistent bundle directory", () => {
    const questions = readQuestions(randomUUID());
    expect(questions).toEqual([]);
  });
});

// ── askQuestion ─────────────────────────────────────────────────────────────

describe("askQuestion", () => {
  test("creates a question with status 'open' and generates a UUID id", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "How does the auth flow work?");

    expect(q.id).toBeTruthy();
    // Verify the id is a valid UUID format
    expect(q.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(q.bundle_id).toBe(bundleId);
    expect(q.asked_by_session_id).toBe(sessionId);
    expect(q.asked_by_project).toBe("frontend");
    expect(q.question).toBe("How does the auth flow work?");
    expect(q.status).toBe("open");
    expect(q.answers).toEqual([]);
    expect(q.target_project).toBeNull();
    expect(q.context).toBeNull();
    expect(q.created_at).toBeTruthy();
  });

  test("persists the question to disk", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "What endpoint should I call?");

    const questions = readQuestions(bundleId);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe("What endpoint should I call?");
  });

  test("sets optional targetProject and context when provided", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "Is the API done?", {
      targetProject: "backend",
      context: "I need the /users endpoint",
    });

    expect(q.target_project).toBe("backend");
    expect(q.context).toBe("I need the /users endpoint");
  });

  test("defaults targetProject to null and context to null", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "General question");

    expect(q.target_project).toBeNull();
    expect(q.context).toBeNull();
  });

  test("multiple questions accumulate on the same bundle", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "Question 1");
    askQuestion(bundleId, sessionId, "frontend", "Question 2");
    askQuestion(bundleId, sessionId, "backend", "Question 3");

    const questions = readQuestions(bundleId);
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.question)).toEqual([
      "Question 1",
      "Question 2",
      "Question 3",
    ]);
  });

  test("each question gets a unique ID", () => {
    const sessionId = randomUUID();
    const q1 = askQuestion(bundleId, sessionId, "frontend", "Q1");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Q2");

    expect(q1.id).not.toBe(q2.id);
  });
});

// ── answerQuestion ──────────────────────────────────────────────────────────

describe("answerQuestion", () => {
  test("adds an answer and changes status to 'answered'", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "How does auth work?");

    const answerSessionId = randomUUID();
    const answer = answerQuestion(
      bundleId,
      q.id,
      answerSessionId,
      "backend",
      "We use JWT tokens via /auth/login",
    );

    expect(answer.id).toBeTruthy();
    expect(answer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(answer.question_id).toBe(q.id);
    expect(answer.answered_by_session_id).toBe(answerSessionId);
    expect(answer.answered_by_project).toBe("backend");
    expect(answer.answer).toBe("We use JWT tokens via /auth/login");
    expect(answer.created_at).toBeTruthy();

    // Verify question status changed
    const updated = getQuestion(bundleId, q.id);
    expect(updated.status).toBe("answered");
    expect(updated.answers).toHaveLength(1);
    expect(updated.answers[0].id).toBe(answer.id);
  });

  test("supports multiple answers on the same question", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "What format should I use?");

    const s1 = randomUUID();
    const s2 = randomUUID();
    answerQuestion(bundleId, q.id, s1, "backend", "Use JSON");
    answerQuestion(bundleId, q.id, s2, "infra", "Also set Content-Type header");

    const updated = getQuestion(bundleId, q.id);
    expect(updated.answers).toHaveLength(2);
    expect(updated.answers[0].answer).toBe("Use JSON");
    expect(updated.answers[1].answer).toBe("Also set Content-Type header");
  });

  test("throws for nonexistent question ID", () => {
    const fakeQuestionId = randomUUID();
    expect(() =>
      answerQuestion(bundleId, fakeQuestionId, randomUUID(), "backend", "answer"),
    ).toThrow(`Question ${fakeQuestionId} not found`);
  });
});

// ── resolveQuestion ─────────────────────────────────────────────────────────

describe("resolveQuestion", () => {
  test("sets question status to 'resolved'", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "Is this done?");

    resolveQuestion(bundleId, q.id);

    const updated = getQuestion(bundleId, q.id);
    expect(updated.status).toBe("resolved");
  });

  test("can resolve an already-answered question", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "Is this done?");
    answerQuestion(bundleId, q.id, randomUUID(), "backend", "Yes it is");

    expect(getQuestion(bundleId, q.id).status).toBe("answered");

    resolveQuestion(bundleId, q.id);
    expect(getQuestion(bundleId, q.id).status).toBe("resolved");
  });

  test("can resolve an open question (no answers)", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "Nevermind, I figured it out");

    resolveQuestion(bundleId, q.id);
    expect(getQuestion(bundleId, q.id).status).toBe("resolved");
  });

  test("throws for nonexistent question ID", () => {
    const fakeId = randomUUID();
    expect(() => resolveQuestion(bundleId, fakeId)).toThrow(
      `Question ${fakeId} not found`,
    );
  });
});

// ── listBundleQuestions ─────────────────────────────────────────────────────

describe("listBundleQuestions", () => {
  test("returns all questions when no filters", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "Q1");
    askQuestion(bundleId, sessionId, "backend", "Q2");

    const list = listBundleQuestions(bundleId);
    expect(list).toHaveLength(2);
  });

  test("returns empty array for bundle with no questions", () => {
    const list = listBundleQuestions(bundleId);
    expect(list).toEqual([]);
  });

  test("filters by status 'open'", () => {
    const sessionId = randomUUID();
    const q1 = askQuestion(bundleId, sessionId, "frontend", "Open question");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Answered question");
    answerQuestion(bundleId, q2.id, randomUUID(), "backend", "Here you go");

    const openOnly = listBundleQuestions(bundleId, { status: "open" });
    expect(openOnly).toHaveLength(1);
    expect(openOnly[0].id).toBe(q1.id);
  });

  test("filters by status 'answered'", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "Open question");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Answered question");
    answerQuestion(bundleId, q2.id, randomUUID(), "backend", "Answer");

    const answered = listBundleQuestions(bundleId, { status: "answered" });
    expect(answered).toHaveLength(1);
    expect(answered[0].id).toBe(q2.id);
  });

  test("filters by status 'resolved'", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "Open");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "To resolve");
    resolveQuestion(bundleId, q2.id);

    const resolved = listBundleQuestions(bundleId, { status: "resolved" });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(q2.id);
  });

  test("filters by targetProject (includes matching + null-targeted questions)", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "General question"); // target_project = null
    askQuestion(bundleId, sessionId, "frontend", "For backend", {
      targetProject: "backend",
    });
    askQuestion(bundleId, sessionId, "frontend", "For infra", {
      targetProject: "infra",
    });

    const backendQuestions = listBundleQuestions(bundleId, {
      targetProject: "backend",
    });
    // Should include: "General question" (null target) + "For backend" (matching target)
    expect(backendQuestions).toHaveLength(2);

    const infraQuestions = listBundleQuestions(bundleId, {
      targetProject: "infra",
    });
    // Should include: "General question" (null target) + "For infra" (matching target)
    expect(infraQuestions).toHaveLength(2);
  });

  test("combines status and targetProject filters", () => {
    const sessionId = randomUUID();
    const q1 = askQuestion(bundleId, sessionId, "frontend", "Open for backend", {
      targetProject: "backend",
    });
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Answered for backend", {
      targetProject: "backend",
    });
    answerQuestion(bundleId, q2.id, randomUUID(), "backend", "Done");

    const q3 = askQuestion(bundleId, sessionId, "frontend", "Open for infra", {
      targetProject: "infra",
    });

    const openBackend = listBundleQuestions(bundleId, {
      status: "open",
      targetProject: "backend",
    });
    expect(openBackend).toHaveLength(1);
    expect(openBackend[0].id).toBe(q1.id);
  });

  test("returns questions sorted by created_at descending", () => {
    const sessionId = randomUUID();

    // Manually create questions with distinct timestamps to guarantee sort order
    const q1 = askQuestion(bundleId, sessionId, "frontend", "First");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Second");
    const q3 = askQuestion(bundleId, sessionId, "frontend", "Third");

    // Patch created_at to guarantee ordering (questions may be created in the same ms)
    const questions = readQuestions(bundleId);
    questions[0].created_at = "2026-01-01T00:00:00.000Z"; // oldest
    questions[1].created_at = "2026-01-01T00:00:01.000Z";
    questions[2].created_at = "2026-01-01T00:00:02.000Z"; // newest

    // Write patched questions back
    const { writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    writeFileSync(
      join(process.env.CTX_LINK_HOME!, "local", bundleId, "questions.json"),
      JSON.stringify(questions, null, 2),
    );

    const list = listBundleQuestions(bundleId);
    // Most recent first
    expect(list).toHaveLength(3);
    expect(list[0].question).toBe("Third");
    expect(list[1].question).toBe("Second");
    expect(list[2].question).toBe("First");
  });
});

// ── getQuestion ─────────────────────────────────────────────────────────────

describe("getQuestion", () => {
  test("returns the question by ID", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "My question");

    const fetched = getQuestion(bundleId, q.id);
    expect(fetched.id).toBe(q.id);
    expect(fetched.question).toBe("My question");
  });

  test("throws for nonexistent question ID", () => {
    const fakeId = randomUUID();
    expect(() => getQuestion(bundleId, fakeId)).toThrow(
      `Question ${fakeId} not found`,
    );
  });

  test("returns question with its answers", () => {
    const sessionId = randomUUID();
    const q = askQuestion(bundleId, sessionId, "frontend", "Question with answers");
    answerQuestion(bundleId, q.id, randomUUID(), "backend", "Answer 1");
    answerQuestion(bundleId, q.id, randomUUID(), "infra", "Answer 2");

    const fetched = getQuestion(bundleId, q.id);
    expect(fetched.answers).toHaveLength(2);
    expect(fetched.answers[0].answer).toBe("Answer 1");
    expect(fetched.answers[1].answer).toBe("Answer 2");
  });
});

// ── countOpenQuestions ───────────────────────────────────────────────────────

describe("countOpenQuestions", () => {
  test("returns 0 for a bundle with no questions", () => {
    expect(countOpenQuestions(bundleId)).toBe(0);
  });

  test("returns 0 for a nonexistent (non-local) bundle", () => {
    expect(countOpenQuestions(randomUUID())).toBe(0);
  });

  test("counts only open questions", () => {
    const sessionId = randomUUID();
    askQuestion(bundleId, sessionId, "frontend", "Open 1");
    askQuestion(bundleId, sessionId, "frontend", "Open 2");
    const q3 = askQuestion(bundleId, sessionId, "frontend", "Will be answered");
    answerQuestion(bundleId, q3.id, randomUUID(), "backend", "Answer");
    const q4 = askQuestion(bundleId, sessionId, "frontend", "Will be resolved");
    resolveQuestion(bundleId, q4.id);

    // 2 open, 1 answered, 1 resolved
    expect(countOpenQuestions(bundleId)).toBe(2);
  });

  test("returns 0 when all questions are answered or resolved", () => {
    const sessionId = randomUUID();
    const q1 = askQuestion(bundleId, sessionId, "frontend", "Answered");
    answerQuestion(bundleId, q1.id, randomUUID(), "backend", "Done");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Resolved");
    resolveQuestion(bundleId, q2.id);

    expect(countOpenQuestions(bundleId)).toBe(0);
  });

  test("count updates as questions change status", () => {
    const sessionId = randomUUID();
    const q1 = askQuestion(bundleId, sessionId, "frontend", "Q1");
    const q2 = askQuestion(bundleId, sessionId, "frontend", "Q2");
    const q3 = askQuestion(bundleId, sessionId, "frontend", "Q3");

    expect(countOpenQuestions(bundleId)).toBe(3);

    answerQuestion(bundleId, q1.id, randomUUID(), "backend", "A1");
    expect(countOpenQuestions(bundleId)).toBe(2);

    resolveQuestion(bundleId, q2.id);
    expect(countOpenQuestions(bundleId)).toBe(1);

    resolveQuestion(bundleId, q3.id);
    expect(countOpenQuestions(bundleId)).toBe(0);
  });
});
