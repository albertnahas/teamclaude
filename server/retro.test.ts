import { describe, it, expect } from "vitest";
import type { SprintState } from "./state";
import type { SprintRecord } from "./analytics";
import { generateRetro } from "./retro";

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    teamName: "alpha",
    projectName: "my-project",
    agents: [
      { name: "sprint-manager", agentId: "a1", agentType: "manager", status: "active" },
      { name: "sprint-engineer-1", agentId: "a2", agentType: "engineer", status: "active" },
    ],
    tasks: [
      { id: "1", subject: "Build auth", status: "completed", owner: "sprint-engineer-1", blockedBy: [] },
      { id: "2", subject: "Fix bug", status: "completed", owner: "sprint-engineer-1", blockedBy: [] },
      { id: "3", subject: "Write docs", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] },
    ],
    messages: [
      { id: "m1", timestamp: 1000, from: "sprint-manager", to: "sprint-engineer-1", content: "TASK_ASSIGNED: #1 — build auth", protocol: "TASK_ASSIGNED" },
      { id: "m2", timestamp: 2000, from: "sprint-engineer-1", to: "sprint-manager", content: "READY_FOR_REVIEW: #1 — done", protocol: "READY_FOR_REVIEW" },
      { id: "m3", timestamp: 3000, from: "sprint-manager", to: "sprint-engineer-1", content: "REQUEST_CHANGES: round 1/3 — fix it", protocol: "REQUEST_CHANGES" },
      { id: "m4", timestamp: 4000, from: "sprint-engineer-1", to: "sprint-manager", content: "RESUBMIT: #1 round 1/3 — addressed", protocol: "RESUBMIT" },
      { id: "m5", timestamp: 5000, from: "sprint-manager", to: "sprint-engineer-1", content: "APPROVED: #1", protocol: "APPROVED" },
    ],
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
    ...overrides,
  };
}

function makeRecord(overrides: Partial<SprintRecord> = {}): SprintRecord {
  return {
    sprintId: "alpha-1700000000000",
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    completedAt: new Date().toISOString(),
    cycle: 1,
    totalTasks: 3,
    completedTasks: 2,
    blockedTasks: 0,
    avgReviewRoundsPerTask: 0.5,
    totalMessages: 5,
    agents: ["sprint-manager", "sprint-engineer-1"],
    ...overrides,
  };
}

describe("generateRetro", () => {
  describe("Sprint Summary section", () => {
    it("includes team, project, cycle, phase, mode", () => {
      const retro = generateRetro(makeState(), []);
      expect(retro).toContain("**Team:** alpha");
      expect(retro).toContain("**Project:** my-project");
      expect(retro).toContain("**Cycle:** 1");
      expect(retro).toContain("**Phase:** sprinting");
      expect(retro).toContain("**Mode:** manual");
    });

    it("includes duration when a matching history record is present", () => {
      const record = makeRecord();
      const retro = generateRetro(makeState(), [record]);
      expect(retro).toContain("**Duration:**");
    });
  });

  describe("Task Results section", () => {
    it("renders a markdown table with task rows", () => {
      const retro = generateRetro(makeState(), []);
      expect(retro).toContain("## Task Results");
      expect(retro).toContain("| # | Task | Status | Owner | Review Rounds |");
      expect(retro).toContain("| #1 | Build auth | Done |");
      expect(retro).toContain("| #3 | Write docs | In Progress |");
    });

    it("counts RESUBMIT messages per task correctly", () => {
      const retro = generateRetro(makeState(), []);
      // Task #1 has 1 RESUBMIT, #2 and #3 have 0
      expect(retro).toMatch(/\| #1 \| Build auth \| Done \|[^|]+\| 1 \|/);
      expect(retro).toMatch(/\| #2 \| Fix bug \| Done \|[^|]+\| 0 \|/);
    });

    it("shows empty state message when no non-deleted tasks", () => {
      const state = makeState({ tasks: [] });
      const retro = generateRetro(state, []);
      expect(retro).toContain("No tasks were created");
    });
  });

  describe("Team Performance section", () => {
    it("shows completion rate, avg review rounds, total messages", () => {
      const retro = generateRetro(makeState(), []);
      expect(retro).toContain("## Team Performance");
      // 2/3 tasks completed = 67%
      expect(retro).toContain("**Completion rate:** 67%");
      expect(retro).toContain("**Total messages:** 5");
    });

    it("shows message flow between agent pairs", () => {
      const retro = generateRetro(makeState(), []);
      expect(retro).toContain("sprint-manager → sprint-engineer-1");
      expect(retro).toContain("sprint-engineer-1 → sprint-manager");
    });
  });

  describe("Velocity Trend section", () => {
    it("is omitted when history has fewer than 2 records for the team", () => {
      const retro = generateRetro(makeState(), [makeRecord()]);
      expect(retro).not.toContain("## Velocity Trend");
    });

    it("shows cycle-over-cycle completion rate change with 2+ records", () => {
      const prev = makeRecord({
        sprintId: "alpha-1600000000000",
        cycle: 0,
        totalTasks: 4,
        completedTasks: 2, // 50%
      });
      const curr = makeRecord({
        sprintId: "alpha-1700000000000",
        cycle: 1,
        totalTasks: 3,
        completedTasks: 3, // 100%
      });
      const retro = generateRetro(makeState(), [prev, curr]);
      expect(retro).toContain("## Velocity Trend");
      expect(retro).toContain("**This cycle:** 100%");
      expect(retro).toContain("**Previous cycle:** 50%");
      expect(retro).toContain("+50%");
    });

    it("shows negative trend when completion rate dropped", () => {
      const prev = makeRecord({
        sprintId: "alpha-1600000000000",
        totalTasks: 4,
        completedTasks: 4, // 100%
      });
      const curr = makeRecord({
        sprintId: "alpha-1700000000000",
        totalTasks: 4,
        completedTasks: 2, // 50%
      });
      const retro = generateRetro(makeState(), [prev, curr]);
      expect(retro).toContain("-50%");
    });

    it("shows 'no change' when completion rate is identical", () => {
      const prev = makeRecord({ sprintId: "alpha-1600000000000", totalTasks: 2, completedTasks: 1 });
      const curr = makeRecord({ sprintId: "alpha-1700000000000", totalTasks: 2, completedTasks: 1 });
      const retro = generateRetro(makeState(), [prev, curr]);
      expect(retro).toContain("no change");
    });
  });

  describe("Agent Activity section", () => {
    it("shows sent/received/total counts per agent", () => {
      const retro = generateRetro(makeState(), []);
      expect(retro).toContain("## Agent Activity");
      expect(retro).toContain("| Agent | Sent | Received | Total |");
      expect(retro).toContain("sprint-manager");
      expect(retro).toContain("sprint-engineer-1");
    });

    it("shows empty state when no messages", () => {
      const state = makeState({ messages: [] });
      const retro = generateRetro(state, []);
      expect(retro).toContain("No agent messages recorded");
    });
  });

  describe("zero tasks edge case", () => {
    it("generates a valid retro with no tasks and no messages", () => {
      const state = makeState({ tasks: [], messages: [] });
      const retro = generateRetro(state, []);
      expect(retro).toContain("# Sprint Retrospective");
      expect(retro).toContain("No tasks were created");
      expect(retro).toContain("No agent messages recorded");
      expect(retro).not.toContain("## Velocity Trend");
    });
  });
});
