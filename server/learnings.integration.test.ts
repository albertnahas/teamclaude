/**
 * Integration tests for the PROCESS_LEARNING pipeline end-to-end.
 *
 * Exercises the full path:
 *   raw message content
 *     → protocol detection (detectProtocol)
 *     → agent learning parsing (parseAgentLearnings)
 *     → persistence (extractProcessLearnings → real filesystem)
 *     → retrieval (getRoleLearnings / loadProcessLearnings)
 *
 * Storage is redirected to a real tmpdir — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Redirect storage to tmpdir before importing modules that use it
const tmpRoot = mkdtempSync(join(tmpdir(), "tc-learnings-integration-"));
const tcDir = join(tmpRoot, ".teamclaude");
const learningsFile = join(tcDir, "learnings.json");

import { vi } from "vitest";

vi.mock("./storage.js", async () => {
  const { mkdirSync } = await import("node:fs");
  return {
    processLearningsPath: () => learningsFile,
    ensureStorageDir: () => mkdirSync(tcDir, { recursive: true }),
  };
});
import { detectProtocol } from "./protocol.js";
import {
  parseAgentLearnings,
  extractProcessLearnings,
  getRoleLearnings,
  loadProcessLearnings,
} from "./learnings.js";
import type { SprintState } from "./state.js";
import type { SprintRecord } from "./analytics.js";

function makeState(messages: SprintState["messages"] = []): SprintState {
  return {
    teamName: "integration-team",
    projectName: "test-project",
    agents: [],
    tasks: [{ id: "1", subject: "T1", status: "completed", owner: "eng", blockedBy: [] }],
    messages,
    paused: false,
    escalation: null,
    mergeConflict: null,
    mode: "manual",
    cycle: 1,
    phase: "sprinting",
    reviewTaskIds: [],
    preValidatingTaskIds: [],
    validatingTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    tmuxAvailable: false,
    tmuxSessionName: null,
  };
}

function makeRecord(overrides: Partial<SprintRecord> = {}): SprintRecord {
  return {
    sprintId: "sprint-integration-1",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    cycle: 1,
    totalTasks: 1,
    completedTasks: 1,
    blockedTasks: 0,
    avgReviewRoundsPerTask: 0,
    totalMessages: 0,
    agents: ["sprint-engineer"],
    ...overrides,
  };
}

beforeAll(() => {});
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => {
  if (existsSync(learningsFile)) rmSync(learningsFile);
});

describe("PROCESS_LEARNING end-to-end pipeline", () => {
  it("detectProtocol identifies PROCESS_LEARNING messages", () => {
    const content = "PROCESS_LEARNING: engineer — Always run tests before submitting";
    expect(detectProtocol(content)).toBe("PROCESS_LEARNING");
  });

  it("detectProtocol does not match partial prefix", () => {
    expect(detectProtocol("Not a PROCESS_LEARNING message")).toBeUndefined();
  });

  it("full pipeline: raw message → parse → store → retrieve", () => {
    const rawContent = "PROCESS_LEARNING: engineer — Always run type-check before submitting";

    // Step 1: detect protocol
    const protocol = detectProtocol(rawContent);
    expect(protocol).toBe("PROCESS_LEARNING");

    // Step 2: build message as watcher would
    const messages: SprintState["messages"] = [
      { id: "m1", timestamp: Date.now(), from: "sprint-engineer", to: "sprint-manager", content: rawContent, protocol },
    ];

    // Step 3: parse agent learnings
    const parsed = parseAgentLearnings(messages);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ role: "engineer", action: "Always run type-check before submitting" });

    // Step 4: extract + persist (uses real filesystem)
    const state = makeState(messages);
    const record = makeRecord({ totalTasks: 1, completedTasks: 1 });
    extractProcessLearnings(state, record, "sprint-integration-1");

    // Step 5: verify persisted to disk
    expect(existsSync(learningsFile)).toBe(true);
    const stored = loadProcessLearnings();
    const agentLearning = stored.learnings.find((l) => l.source === "agent" && l.role === "engineer");
    expect(agentLearning).toBeDefined();
    expect(agentLearning!.action).toBe("Always run type-check before submitting");
    expect(agentLearning!.sprintIds).toContain("sprint-integration-1");

    // Step 6: retrieve via getRoleLearnings
    const roleLearnings = getRoleLearnings();
    expect(roleLearnings.engineer).toContain("Always run type-check before submitting");
  });

  it("orchestrator PROCESS_LEARNING messages are stored and retrieved", () => {
    const rawContent = "PROCESS_LEARNING: orchestrator — Assign blocking tasks before dependent ones";
    expect(detectProtocol(rawContent)).toBe("PROCESS_LEARNING");

    const messages: SprintState["messages"] = [
      { id: "m1", timestamp: Date.now(), from: "orchestrator", to: "sprint-manager", content: rawContent, protocol: "PROCESS_LEARNING" },
    ];

    extractProcessLearnings(makeState(messages), makeRecord(), "sprint-orch-1");

    const stored = loadProcessLearnings();
    const learning = stored.learnings.find((l) => l.role === "orchestrator");
    expect(learning).toBeDefined();
    expect(learning!.action).toContain("blocking tasks");

    const roleLearnings = getRoleLearnings();
    expect(roleLearnings.orchestrator).toContain("blocking tasks");
  });

  it("frequency increments across sprints and orchestrator cross-role surface picks up high-freq items", () => {
    const messages: SprintState["messages"] = [
      { id: "m1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: manager — Give all feedback in one round", protocol: "PROCESS_LEARNING" },
    ];

    // Run twice — simulating two sprints with same signal
    extractProcessLearnings(makeState(messages), makeRecord(), "sprint-a");
    extractProcessLearnings(makeState(messages), makeRecord(), "sprint-b");

    const stored = loadProcessLearnings();
    const learning = stored.learnings.find((l) => l.role === "manager" && l.source === "agent");
    expect(learning).toBeDefined();
    expect(learning!.frequency).toBe(2);

    // After two sprints the item is high-frequency (≥2), orchestrator should surface it
    const roleLearnings = getRoleLearnings();
    expect(roleLearnings.orchestrator).toContain("Give all feedback in one round");
  });

  it("multiple roles in one sprint are stored independently", () => {
    const messages: SprintState["messages"] = [
      { id: "m1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: pm — Break tasks into small units", protocol: "PROCESS_LEARNING" },
      { id: "m2", timestamp: 2, from: "eng", to: "mgr", content: "PROCESS_LEARNING: engineer — Read existing code before editing", protocol: "PROCESS_LEARNING" },
      { id: "m3", timestamp: 3, from: "mgr", to: "lead", content: "PROCESS_LEARNING: manager — Assign blocking tasks first", protocol: "PROCESS_LEARNING" },
    ];

    extractProcessLearnings(makeState(messages), makeRecord(), "sprint-multi");

    const roleLearnings = getRoleLearnings();
    expect(roleLearnings.pm).toContain("Break tasks into small units");
    expect(roleLearnings.engineer).toContain("Read existing code before editing");
    expect(roleLearnings.manager).toContain("Assign blocking tasks first");
  });
});
