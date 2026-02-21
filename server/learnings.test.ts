import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SprintState } from "./state";
import type { SprintRecord } from "./analytics";

const tmpProjectRoot = mkdtempSync(join(tmpdir(), "tc-learnings-test-"));

vi.mock("./storage.js", () => {
  const _join = require("node:path").join;
  const _mkdirSync = require("node:fs").mkdirSync;
  const tcDir = () => _join(tmpProjectRoot, ".teamclaude");
  return {
    processLearningsPath: () => _join(tcDir(), "learnings.json"),
    ensureStorageDir: () => {
      _mkdirSync(tcDir(), { recursive: true });
    },
  };
});

const {
  SIGNALS,
  loadProcessLearnings,
  extractProcessLearnings,
  getRoleLearnings,
  parseAgentLearnings,
  simpleHash,
  saveAndRemoveLearning,
} = await import("./learnings.js");

const processLearningsFile = join(tmpProjectRoot, ".teamclaude", "learnings.json");

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    teamName: "test-team",
    projectName: "test-project",
    agents: [],
    tasks: [
      { id: "1", subject: "Task 1", status: "completed", owner: "eng", blockedBy: [] },
      { id: "2", subject: "Task 2", status: "in_progress", owner: "eng", blockedBy: [] },
    ],
    messages: [],
    paused: false,
    escalation: null,
    mode: "manual",
    cycle: 1,
    phase: "sprinting",
    reviewTaskIds: [],
    validatingTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    tmuxAvailable: false,
    tmuxSessionName: null,
    mergeConflict: null,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<SprintRecord> = {}): SprintRecord {
  return {
    sprintId: "test-team-123",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    cycle: 1,
    totalTasks: 2,
    completedTasks: 1,
    blockedTasks: 0,
    avgReviewRoundsPerTask: 0,
    totalMessages: 0,
    agents: ["sprint-engineer"],
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(processLearningsFile)) rmSync(processLearningsFile);
});

// --- Signal detection tests ---

describe("SIGNALS", () => {
  describe("LOW_COMPLETION_RATE", () => {
    it("fires when completion < 60%", () => {
      const state = makeState();
      const record = makeRecord({ totalTasks: 10, completedTasks: 5 });
      expect(SIGNALS.LOW_COMPLETION_RATE.detect(state, record)).toBe(true);
    });

    it("does not fire when completion >= 60%", () => {
      const record = makeRecord({ totalTasks: 10, completedTasks: 6 });
      expect(SIGNALS.LOW_COMPLETION_RATE.detect(makeState(), record)).toBe(false);
    });

    it("does not fire when totalTasks is 0", () => {
      const record = makeRecord({ totalTasks: 0, completedTasks: 0 });
      expect(SIGNALS.LOW_COMPLETION_RATE.detect(makeState(), record)).toBe(false);
    });
  });

  describe("HIGH_REVIEW_ROUNDS", () => {
    it("fires when avgReviewRounds > 1.5", () => {
      const record = makeRecord({ avgReviewRoundsPerTask: 2.0 });
      expect(SIGNALS.HIGH_REVIEW_ROUNDS.detect(makeState(), record)).toBe(true);
    });

    it("does not fire when avgReviewRounds <= 1.5", () => {
      const record = makeRecord({ avgReviewRoundsPerTask: 1.5 });
      expect(SIGNALS.HIGH_REVIEW_ROUNDS.detect(makeState(), record)).toBe(false);
    });
  });

  describe("ESCALATION_OCCURRED", () => {
    it("fires when ESCALATE message exists", () => {
      const state = makeState({
        messages: [
          { id: "1", timestamp: 1, from: "eng", to: "mgr", content: "ESCALATE: stuck", protocol: "ESCALATE" },
        ],
      });
      expect(SIGNALS.ESCALATION_OCCURRED.detect(state, makeRecord())).toBe(true);
    });

    it("fires when ESCALATION message exists (legacy)", () => {
      const state = makeState({
        messages: [
          { id: "1", timestamp: 1, from: "eng", to: "mgr", content: "help", protocol: "ESCALATION" },
        ],
      });
      expect(SIGNALS.ESCALATION_OCCURRED.detect(state, makeRecord())).toBe(true);
    });

    it("does not fire with no escalation messages", () => {
      expect(SIGNALS.ESCALATION_OCCURRED.detect(makeState(), makeRecord())).toBe(false);
    });
  });

  describe("UNBALANCED_WORKLOAD", () => {
    it("fires when one engineer owns > 60% of tasks", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "completed", owner: "eng-1", blockedBy: [] },
          { id: "2", subject: "T2", status: "completed", owner: "eng-1", blockedBy: [] },
          { id: "3", subject: "T3", status: "completed", owner: "eng-1", blockedBy: [] },
          { id: "4", subject: "T4", status: "completed", owner: "eng-2", blockedBy: [] },
        ],
      });
      expect(SIGNALS.UNBALANCED_WORKLOAD.detect(state, makeRecord())).toBe(true);
    });

    it("does not fire with balanced workload", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "completed", owner: "eng-1", blockedBy: [] },
          { id: "2", subject: "T2", status: "completed", owner: "eng-2", blockedBy: [] },
        ],
      });
      expect(SIGNALS.UNBALANCED_WORKLOAD.detect(state, makeRecord())).toBe(false);
    });

    it("does not fire with single engineer", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "completed", owner: "eng-1", blockedBy: [] },
        ],
      });
      expect(SIGNALS.UNBALANCED_WORKLOAD.detect(state, makeRecord())).toBe(false);
    });
  });

  describe("BLOCKED_TASKS_AT_END", () => {
    it("fires when non-completed tasks are blocked", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "pending", owner: "", blockedBy: ["2"] },
          { id: "2", subject: "T2", status: "completed", owner: "eng", blockedBy: [] },
        ],
      });
      expect(SIGNALS.BLOCKED_TASKS_AT_END.detect(state, makeRecord())).toBe(true);
    });

    it("does not fire when blocked tasks are completed", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "completed", owner: "eng", blockedBy: ["2"] },
        ],
      });
      expect(SIGNALS.BLOCKED_TASKS_AT_END.detect(state, makeRecord())).toBe(false);
    });
  });

  describe("STALE_TASKS", () => {
    it("fires when in_progress task has no protocol messages in second half", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "in_progress", owner: "eng-1", blockedBy: [] },
        ],
        messages: [
          { id: "m1", timestamp: 100, from: "mgr", to: "eng-1", content: "TASK_ASSIGNED: #1", protocol: "TASK_ASSIGNED" },
          { id: "m2", timestamp: 200, from: "mgr", to: "eng-2", content: "check", protocol: "TASK_ASSIGNED" },
        ],
      });
      expect(SIGNALS.STALE_TASKS.detect(state, makeRecord())).toBe(true);
    });

    it("does not fire when no tasks are in_progress", () => {
      const state = makeState({
        tasks: [
          { id: "1", subject: "T1", status: "completed", owner: "eng", blockedBy: [] },
        ],
      });
      expect(SIGNALS.STALE_TASKS.detect(state, makeRecord())).toBe(false);
    });
  });

  describe("ZERO_TASKS_CREATED", () => {
    it("fires when totalTasks is 0", () => {
      expect(SIGNALS.ZERO_TASKS_CREATED.detect(makeState(), makeRecord({ totalTasks: 0 }))).toBe(true);
    });

    it("does not fire when totalTasks > 0", () => {
      expect(SIGNALS.ZERO_TASKS_CREATED.detect(makeState(), makeRecord({ totalTasks: 1 }))).toBe(false);
    });
  });
});

// --- Process learnings extraction ---

describe("extractProcessLearnings", () => {
  it("creates learnings from signal detection", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 }); // LOW_COMPLETION_RATE
    const store = extractProcessLearnings(state, record, "sprint-1");

    expect(store.learnings.length).toBeGreaterThan(0);
    const pmLearning = store.learnings.find((l) => l.id === "LOW_COMPLETION_RATE:pm");
    expect(pmLearning).toBeDefined();
    expect(pmLearning!.source).toBe("signal");
    expect(pmLearning!.role).toBe("pm");
    expect(pmLearning!.frequency).toBe(1);
    expect(pmLearning!.sprintIds).toEqual(["sprint-1"]);
  });

  it("increments frequency on duplicate signal", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 });
    extractProcessLearnings(state, record, "sprint-1");
    const store = extractProcessLearnings(state, record, "sprint-2");

    const pmLearning = store.learnings.find((l) => l.id === "LOW_COMPLETION_RATE:pm");
    expect(pmLearning!.frequency).toBe(2);
    expect(pmLearning!.sprintIds).toEqual(["sprint-1", "sprint-2"]);
  });

  it("does not duplicate sprintId on same sprint", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 });
    extractProcessLearnings(state, record, "sprint-1");
    const store = extractProcessLearnings(state, record, "sprint-1");

    const pmLearning = store.learnings.find((l) => l.id === "LOW_COMPLETION_RATE:pm");
    expect(pmLearning!.sprintIds).toEqual(["sprint-1"]);
  });

  it("parses agent PROCESS_LEARNING messages", () => {
    const state = makeState({
      messages: [
        {
          id: "m1",
          timestamp: 1,
          from: "sprint-manager",
          to: "team-lead",
          content: "PROCESS_LEARNING: pm — Task descriptions lacked file paths",
          protocol: "PROCESS_LEARNING",
        },
      ],
    });
    const record = makeRecord({ totalTasks: 5, completedTasks: 5 }); // No signal fires
    const store = extractProcessLearnings(state, record, "sprint-1");

    const agentLearning = store.learnings.find((l) => l.source === "agent");
    expect(agentLearning).toBeDefined();
    expect(agentLearning!.role).toBe("pm");
    expect(agentLearning!.action).toBe("Task descriptions lacked file paths");
    expect(agentLearning!.signal).toBe("AGENT_REFLECTION");
  });

  it("caps agent learnings at 5 per sprint", () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      timestamp: i,
      from: "sprint-manager",
      to: "team-lead",
      content: `PROCESS_LEARNING: manager — Improvement ${i}`,
      protocol: "PROCESS_LEARNING" as const,
    }));
    const state = makeState({ messages });
    const record = makeRecord({ totalTasks: 5, completedTasks: 5 });
    const store = extractProcessLearnings(state, record, "sprint-1");

    const agentLearnings = store.learnings.filter((l) => l.source === "agent");
    expect(agentLearnings.length).toBe(5);
  });

  it("persists to disk", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 });
    extractProcessLearnings(state, record, "sprint-1");

    expect(existsSync(processLearningsFile)).toBe(true);
    const raw = JSON.parse(readFileSync(processLearningsFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.learnings.length).toBeGreaterThan(0);
  });
});

// --- Agent learning parsing ---

describe("parseAgentLearnings", () => {
  it("parses valid PROCESS_LEARNING messages", () => {
    const messages = [
      { id: "1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: pm — Better task descriptions", protocol: "PROCESS_LEARNING" },
      { id: "2", timestamp: 2, from: "mgr", to: "lead", content: "PROCESS_LEARNING: engineer — Run tests first", protocol: "PROCESS_LEARNING" },
    ] as SprintState["messages"];
    const result = parseAgentLearnings(messages);
    expect(result).toEqual([
      { role: "pm", action: "Better task descriptions" },
      { role: "engineer", action: "Run tests first" },
    ]);
  });

  it("ignores messages without PROCESS_LEARNING protocol", () => {
    const messages = [
      { id: "1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: pm — test", protocol: undefined },
    ] as SprintState["messages"];
    expect(parseAgentLearnings(messages)).toEqual([]);
  });

  it("ignores malformed messages", () => {
    const messages = [
      { id: "1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: invalid_role — test", protocol: "PROCESS_LEARNING" },
      { id: "2", timestamp: 2, from: "mgr", to: "lead", content: "PROCESS_LEARNING: pm", protocol: "PROCESS_LEARNING" },
    ] as SprintState["messages"];
    expect(parseAgentLearnings(messages)).toEqual([]);
  });

  it("handles em-dash, en-dash, and hyphen separators", () => {
    const messages = [
      { id: "1", timestamp: 1, from: "mgr", to: "lead", content: "PROCESS_LEARNING: pm \u2014 em-dash", protocol: "PROCESS_LEARNING" },
      { id: "2", timestamp: 2, from: "mgr", to: "lead", content: "PROCESS_LEARNING: manager \u2013 en-dash", protocol: "PROCESS_LEARNING" },
      { id: "3", timestamp: 3, from: "mgr", to: "lead", content: "PROCESS_LEARNING: engineer - hyphen", protocol: "PROCESS_LEARNING" },
    ] as SprintState["messages"];
    const result = parseAgentLearnings(messages);
    expect(result).toHaveLength(3);
  });
});

// --- Role-filtered retrieval ---

describe("getRoleLearnings", () => {
  it("returns empty strings when no learnings exist", () => {
    const result = getRoleLearnings();
    expect(result.orchestrator).toBe("");
    expect(result.pm).toBe("");
    expect(result.manager).toBe("");
    expect(result.engineer).toBe("");
  });

  it("groups learnings by role", () => {
    // Create learnings via extraction
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 }); // LOW_COMPLETION_RATE
    extractProcessLearnings(state, record, "sprint-1");

    const result = getRoleLearnings();
    expect(result.pm).toContain("Break tasks");
    expect(result.manager).toContain("stalls");
    expect(result.engineer).toContain("partial progress");
  });

  it("sorts by frequency descending", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 });
    extractProcessLearnings(state, record, "sprint-1");
    extractProcessLearnings(state, record, "sprint-2"); // frequency bumps to 2

    const result = getRoleLearnings();
    expect(result.pm).toContain("\u00d72");
  });

  it("limits per-role count", () => {
    // Create a store with many learnings for one role
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    const store = {
      version: 1,
      learnings: Array.from({ length: 10 }, (_, i) => ({
        id: `TEST:pm:${i}`,
        signal: "TEST",
        source: "signal" as const,
        role: "pm" as const,
        action: `Action ${i}`,
        frequency: 10 - i,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        sprintIds: ["s1"],
      })),
    };
    writeFileSync(processLearningsFile, JSON.stringify(store), "utf-8");

    const result = getRoleLearnings(3);
    const lines = result.pm.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it("orchestrator gets only frequency >= 2 items", () => {
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    const store = {
      version: 1,
      learnings: [
        { id: "a", signal: "A", source: "signal", role: "pm", action: "High freq", frequency: 3, firstSeen: "", lastSeen: "", sprintIds: [] },
        { id: "b", signal: "B", source: "signal", role: "pm", action: "Low freq", frequency: 1, firstSeen: "", lastSeen: "", sprintIds: [] },
      ],
    };
    writeFileSync(processLearningsFile, JSON.stringify(store), "utf-8");

    const result = getRoleLearnings();
    expect(result.orchestrator).toContain("High freq");
    expect(result.orchestrator).not.toContain("Low freq");
  });
});

// --- Dedup ---

describe("simpleHash", () => {
  it("returns consistent hash for same input", () => {
    expect(simpleHash("test")).toBe(simpleHash("test"));
  });

  it("returns different hash for different input", () => {
    expect(simpleHash("foo")).not.toBe(simpleHash("bar"));
  });
});

describe("saveAndRemoveLearning", () => {
  it("removes a learning by ID", () => {
    const state = makeState();
    const record = makeRecord({ totalTasks: 10, completedTasks: 3 });
    extractProcessLearnings(state, record, "sprint-1");

    const store = loadProcessLearnings();
    const first = store.learnings[0];
    expect(saveAndRemoveLearning(first.id)).toBe(true);

    const updated = loadProcessLearnings();
    expect(updated.learnings.find((l) => l.id === first.id)).toBeUndefined();
  });

  it("returns false for non-existent ID", () => {
    expect(saveAndRemoveLearning("nonexistent")).toBe(false);
  });
});

// --- loadProcessLearnings ---

describe("loadProcessLearnings", () => {
  it("returns empty store when file does not exist", () => {
    const store = loadProcessLearnings();
    expect(store).toEqual({ version: 1, learnings: [] });
  });

  it("returns empty store for invalid JSON", () => {
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    writeFileSync(processLearningsFile, "not json", "utf-8");
    const store = loadProcessLearnings();
    expect(store).toEqual({ version: 1, learnings: [] });
  });
});
