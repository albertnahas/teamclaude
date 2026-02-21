import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SprintState } from "./state";
import type { SprintRecord } from "./analytics";

const tmpProjectRoot = mkdtempSync(join(tmpdir(), "tc-learnings-test-"));

vi.mock("./storage.js", () => {
  const _join = require("node:path").join;
  const _mkdirSync = require("node:fs").mkdirSync;
  const _writeFileSync = require("node:fs").writeFileSync;
  const _existsSync = require("node:fs").existsSync;
  const tcDir = () => _join(tmpProjectRoot, ".teamclaude");
  return {
    learningsPath: () => _join(tcDir(), "learnings.md"),
    ensureStorageDir: () => {
      _mkdirSync(tcDir(), { recursive: true });
    },
  };
});

const { loadLearnings, appendLearnings, getRecentLearnings } = await import(
  "./learnings.js"
);

const learningsFile = join(tmpProjectRoot, ".teamclaude", "learnings.md");

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
  if (existsSync(learningsFile)) rmSync(learningsFile);
});

describe("loadLearnings", () => {
  it("returns empty string when file does not exist", () => {
    expect(loadLearnings()).toBe("");
  });

  it("returns file content when it exists", () => {
    mkdirSync(join(tmpProjectRoot, ".teamclaude"), { recursive: true });
    const { writeFileSync } = require("node:fs");
    writeFileSync(learningsFile, "# Sprint Learnings\n\nSome content", "utf-8");
    expect(loadLearnings()).toBe("# Sprint Learnings\n\nSome content");
  });
});

describe("appendLearnings", () => {
  it("creates the file with header on first call", () => {
    const state = makeState();
    const record = makeRecord();
    appendLearnings(state, record, "retro text");

    expect(existsSync(learningsFile)).toBe(true);
    const content = readFileSync(learningsFile, "utf-8");
    expect(content).toContain("# Sprint Learnings");
    expect(content).toContain("## Sprint test-team-123");
    expect(content).toContain("Task 1");
  });

  it("includes completed and incomplete task sections", () => {
    appendLearnings(makeState(), makeRecord(), "retro");

    const content = readFileSync(learningsFile, "utf-8");
    expect(content).toContain("### Completed");
    expect(content).toContain("- Task 1");
    expect(content).toContain("### Incomplete");
    expect(content).toContain("- Task 2 (in_progress)");
  });

  it("appends to existing file on subsequent calls", () => {
    appendLearnings(makeState(), makeRecord({ sprintId: "first" }), "retro");
    appendLearnings(makeState(), makeRecord({ sprintId: "second" }), "retro");

    const content = readFileSync(learningsFile, "utf-8");
    expect(content).toContain("## Sprint first");
    expect(content).toContain("## Sprint second");
  });

  it("includes escalations when present", () => {
    const state = makeState({
      messages: [
        { id: "e1", timestamp: 1000, from: "eng", to: "mgr", content: "Stuck on auth", protocol: "ESCALATION" },
      ],
    });
    appendLearnings(state, makeRecord(), "retro");

    const content = readFileSync(learningsFile, "utf-8");
    expect(content).toContain("### Escalations");
    expect(content).toContain("eng: Stuck on auth");
  });
});

describe("getRecentLearnings", () => {
  it("returns empty string when no file exists", () => {
    expect(getRecentLearnings()).toBe("");
  });

  it("returns last N sprint sections", () => {
    appendLearnings(makeState(), makeRecord({ sprintId: "s1" }), "retro");
    appendLearnings(makeState(), makeRecord({ sprintId: "s2" }), "retro");
    appendLearnings(makeState(), makeRecord({ sprintId: "s3" }), "retro");
    appendLearnings(makeState(), makeRecord({ sprintId: "s4" }), "retro");

    const recent = getRecentLearnings(2);
    expect(recent).not.toContain("## Sprint s1");
    expect(recent).not.toContain("## Sprint s2");
    expect(recent).toContain("## Sprint s3");
    expect(recent).toContain("## Sprint s4");
  });

  it("returns all sections when fewer than N exist", () => {
    appendLearnings(makeState(), makeRecord({ sprintId: "only" }), "retro");

    const recent = getRecentLearnings(3);
    expect(recent).toContain("## Sprint only");
  });
});
