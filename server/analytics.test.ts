import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { SprintState } from "./state";

// Create a temp directory to act as project root
const tmpProjectRoot = mkdtempSync(join(tmpdir(), "tc-analytics-test-"));

// Mock storage.js to use the temp directory
vi.mock("./storage.js", () => {
  const _join = require("node:path").join;
  const _mkdirSync = require("node:fs").mkdirSync;
  const _writeFileSync = require("node:fs").writeFileSync;
  const _existsSync = require("node:fs").existsSync;
  const tcDir = () => _join(tmpProjectRoot, ".teamclaude");
  return {
    analyticsPath: () => _join(tcDir(), "analytics.json"),
    ensureStorageDir: () => {
      _mkdirSync(tcDir(), { recursive: true });
      const gitignore = _join(tcDir(), ".gitignore");
      if (!_existsSync(gitignore)) {
        _writeFileSync(gitignore, "state.json\nanalytics.json\n", "utf-8");
      }
    },
    ensureSprintHistoryDir: (id: string) => {
      const dir = _join(tcDir(), "history", id);
      _mkdirSync(dir, { recursive: true });
      return dir;
    },
  };
});

// Import AFTER mocking so the module picks up mocked storage
const {
  recordSprintCompletion,
  loadSprintHistory,
  saveSprintSnapshot,
  saveRetroToHistory,
  saveRecordToHistory,
  migrateGlobalAnalytics,
} = await import("./analytics.js");

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

const analyticsFile = join(tmpProjectRoot, ".teamclaude", "analytics.json");

beforeEach(() => {
  if (existsSync(analyticsFile)) rmSync(analyticsFile);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadSprintHistory", () => {
  it("returns empty array when file does not exist", () => {
    expect(loadSprintHistory()).toEqual([]);
  });

  it("returns empty array when file contains invalid JSON", () => {
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    writeFileSync(analyticsFile, "not-valid-json", "utf-8");
    expect(loadSprintHistory()).toEqual([]);
  });

  it("returns empty array when file contains non-array JSON", () => {
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    writeFileSync(analyticsFile, JSON.stringify({ not: "an array" }), "utf-8");
    expect(loadSprintHistory()).toEqual([]);
  });
});

describe("recordSprintCompletion", () => {
  it("creates the file with one record on first call and returns the record", () => {
    const state = makeState();
    const record = recordSprintCompletion(state, Date.now() - 5000);

    expect(record).toBeDefined();
    expect(record.cycle).toBe(2);

    const history = loadSprintHistory();
    expect(history).toHaveLength(1);

    expect(history[0].totalTasks).toBe(2);
    expect(history[0].completedTasks).toBe(1);
    expect(history[0].blockedTasks).toBe(1);
    expect(history[0].totalMessages).toBe(4);
    expect(history[0].agents).toEqual(["sprint-manager", "sprint-engineer-1"]);
    expect(history[0].sprintId).toContain("test-team");
    expect(history[0].startedAt).toBeTruthy();
    expect(history[0].completedAt).toBeTruthy();
  });

  it("appends to existing records", () => {
    const state = makeState();
    recordSprintCompletion(state);
    recordSprintCompletion(state);

    expect(loadSprintHistory()).toHaveLength(2);
  });

  it("calculates avgReviewRoundsPerTask correctly", () => {
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

describe("saveSprintSnapshot", () => {
  it("writes tasks.json and messages.json to history dir", () => {
    const state = makeState();
    saveSprintSnapshot("sprint-test-1", state);

    const histDir = join(tmpProjectRoot, ".teamclaude", "history", "sprint-test-1");
    expect(existsSync(join(histDir, "tasks.json"))).toBe(true);
    expect(existsSync(join(histDir, "messages.json"))).toBe(true);

    const tasks = JSON.parse(readFileSync(join(histDir, "tasks.json"), "utf-8"));
    expect(tasks).toHaveLength(2);
  });
});

describe("saveRetroToHistory", () => {
  it("writes retro.md to history dir", () => {
    saveRetroToHistory("sprint-test-2", "# Retro\nGood sprint");

    const histDir = join(tmpProjectRoot, ".teamclaude", "history", "sprint-test-2");
    const content = readFileSync(join(histDir, "retro.md"), "utf-8");
    expect(content).toBe("# Retro\nGood sprint");
  });
});

describe("saveRecordToHistory", () => {
  it("writes record.json to history dir", () => {
    const record = recordSprintCompletion(makeState());
    saveRecordToHistory("sprint-test-3", record);

    const histDir = join(tmpProjectRoot, ".teamclaude", "history", "sprint-test-3");
    const saved = JSON.parse(readFileSync(join(histDir, "record.json"), "utf-8"));
    expect(saved.cycle).toBe(2);
  });
});

describe("migrateGlobalAnalytics", () => {
  it("does nothing when local analytics already exists", () => {
    // Create local analytics first
    const state = makeState();
    recordSprintCompletion(state);
    const before = loadSprintHistory();

    // Create a global file with different data
    const globalDir = join(homedir(), ".claude");
    mkdirSync(globalDir, { recursive: true });
    const globalPath = join(globalDir, "teamclaude-analytics.json");
    const hadGlobal = existsSync(globalPath);
    if (!hadGlobal) {
      writeFileSync(globalPath, "[]", "utf-8");
    }

    migrateGlobalAnalytics();

    // Local should be unchanged
    expect(loadSprintHistory()).toEqual(before);

    // Cleanup if we created it
    if (!hadGlobal && existsSync(globalPath)) rmSync(globalPath);
  });
});
