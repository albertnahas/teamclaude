import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SprintState } from "./state";

// Mock `node:os` so the analytics file lands in a temp dir instead of ~/.claude
const tmpAnalyticsDir = mkdtempSync(join(tmpdir(), "tc-analytics-test-"));

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => tmpAnalyticsDir };
});

// Import AFTER mocking so the module picks up the mocked homedir
const { recordSprintCompletion, loadSprintHistory } = await import(
  "./analytics.js"
);

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    teamName: "test-team",
    projectName: "test-project",
    agents: [
      { name: "sprint-manager", agentId: "a1", agentType: "manager", status: "active" },
      { name: "sprint-engineer-1", agentId: "a2", agentType: "engineer", status: "active" },
    ],
    tasks: [
      { id: "1", subject: "Task 1", status: "completed", owner: "sprint-engineer-1", blockedBy: [] },
      { id: "2", subject: "Task 2", status: "in_progress", owner: "sprint-engineer-1", blockedBy: ["1"] },
    ],
    messages: [
      { id: "m1", timestamp: 1000, from: "sprint-manager", to: "sprint-engineer-1", content: "TASK_ASSIGNED: #1 — do it", protocol: "TASK_ASSIGNED" },
      { id: "m2", timestamp: 2000, from: "sprint-engineer-1", to: "sprint-manager", content: "READY_FOR_REVIEW: #1 — done", protocol: "READY_FOR_REVIEW" },
      { id: "m3", timestamp: 3000, from: "sprint-manager", to: "sprint-engineer-1", content: "REQUEST_CHANGES: round 1/3 — fix it", protocol: "REQUEST_CHANGES" },
      { id: "m4", timestamp: 4000, from: "sprint-engineer-1", to: "sprint-manager", content: "RESUBMIT: #1 round 1/3 — addressed", protocol: "RESUBMIT" },
    ],
    paused: false,
    escalation: null,
    mode: "manual",
    cycle: 2,
    phase: "sprinting",
    reviewTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    ...overrides,
  };
}

const analyticsPath = join(tmpAnalyticsDir, ".claude", "teamclaude-analytics.json");

beforeEach(() => {
  if (existsSync(analyticsPath)) rmSync(analyticsPath);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadSprintHistory", () => {
  it("returns empty array when file does not exist", () => {
    expect(loadSprintHistory()).toEqual([]);
  });

  it("returns empty array when file contains invalid JSON", () => {
    mkdirSync(join(tmpAnalyticsDir, ".claude"), { recursive: true });
    writeFileSync(analyticsPath, "not-valid-json", "utf-8");
    expect(loadSprintHistory()).toEqual([]);
  });

  it("returns empty array when file contains non-array JSON", () => {
    mkdirSync(join(tmpAnalyticsDir, ".claude"), { recursive: true });
    writeFileSync(analyticsPath, JSON.stringify({ not: "an array" }), "utf-8");
    expect(loadSprintHistory()).toEqual([]);
  });
});

describe("recordSprintCompletion", () => {
  it("creates the file with one record on first call", () => {
    const state = makeState();
    recordSprintCompletion(state, Date.now() - 5000);

    const history = loadSprintHistory();
    expect(history).toHaveLength(1);

    const record = history[0];
    expect(record.cycle).toBe(2);
    expect(record.totalTasks).toBe(2);
    expect(record.completedTasks).toBe(1);
    expect(record.blockedTasks).toBe(1);
    expect(record.totalMessages).toBe(4);
    expect(record.agents).toEqual(["sprint-manager", "sprint-engineer-1"]);
    expect(record.sprintId).toContain("test-team");
    expect(record.startedAt).toBeTruthy();
    expect(record.completedAt).toBeTruthy();
    expect(new Date(record.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(record.startedAt).getTime()
    );
  });

  it("appends to existing records", () => {
    const state = makeState();
    recordSprintCompletion(state);
    recordSprintCompletion(state);

    expect(loadSprintHistory()).toHaveLength(2);
  });

  it("calculates avgReviewRoundsPerTask correctly", () => {
    // 1 completed task with 1 RESUBMIT message referencing #1 → avg = 1
    const state = makeState();
    recordSprintCompletion(state);

    const [record] = loadSprintHistory();
    expect(record.avgReviewRoundsPerTask).toBe(1);
  });

  it("returns 0 avgReviewRoundsPerTask when no completed tasks", () => {
    const state = makeState({
      tasks: [
        { id: "1", subject: "Task 1", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] },
      ],
      messages: [],
    });
    recordSprintCompletion(state);

    const [record] = loadSprintHistory();
    expect(record.avgReviewRoundsPerTask).toBe(0);
  });

  it("uses provided startedAt timestamp", () => {
    const startedAt = Date.now() - 60_000;
    recordSprintCompletion(makeState(), startedAt);

    const [record] = loadSprintHistory();
    expect(new Date(record.startedAt).getTime()).toBe(startedAt);
  });

  it("records correct counts for all-completed sprint", () => {
    const state = makeState({
      tasks: [
        { id: "1", subject: "T1", status: "completed", owner: "e1", blockedBy: [] },
        { id: "2", subject: "T2", status: "completed", owner: "e1", blockedBy: [] },
        { id: "3", subject: "T3", status: "completed", owner: "e1", blockedBy: [] },
      ],
      messages: [],
    });
    recordSprintCompletion(state);

    const [record] = loadSprintHistory();
    expect(record.totalTasks).toBe(3);
    expect(record.completedTasks).toBe(3);
    expect(record.blockedTasks).toBe(0);
  });
});
