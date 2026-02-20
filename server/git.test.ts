import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SprintState } from "./state.js";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Must import after mocking
const { execFile } = await import("node:child_process");
const { createSprintBranch, generatePRSummary, getCurrentBranch } =
  await import("./git.js");

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, { stdout, stderr: "" })
  );
}

function mockFailure(message = "fatal: not a git repository") {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(new Error(message))
  );
}

const CWD = "/fake/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentBranch", () => {
  it("returns the current branch name", async () => {
    mockSuccess("main\n");
    expect(await getCurrentBranch(CWD)).toBe("main");
  });

  it("returns null when git fails", async () => {
    mockFailure();
    expect(await getCurrentBranch(CWD)).toBeNull();
  });
});

describe("createSprintBranch", () => {
  it("returns the branch name on success", async () => {
    // git checkout -b succeeds (stdout is empty on success, result is "")
    mockSuccess("");
    const result = await createSprintBranch("myteam", 2, CWD);
    expect(result).toBe("sprint/myteam-cycle2");
  });

  it("returns null when git is unavailable", async () => {
    // checkout fails
    mockFailure("git: command not found");
    // getCurrentBranch (fallback) also fails
    mockFailure("git: command not found");
    const result = await createSprintBranch("myteam", 1, CWD);
    expect(result).toBeNull();
  });

  it("returns branch name when already on the sprint branch", async () => {
    // checkout fails (branch already exists)
    mockFailure("fatal: A branch named 'sprint/myteam-cycle3' already exists.");
    // getCurrentBranch returns the sprint branch
    mockSuccess("sprint/myteam-cycle3\n");
    const result = await createSprintBranch("myteam", 3, CWD);
    expect(result).toBe("sprint/myteam-cycle3");
  });
});

describe("generatePRSummary", () => {
  const baseState: SprintState = {
    teamName: "alpha",
    projectName: "my-project",
    agents: [],
    tasks: [
      { id: "1", subject: "Task A", status: "completed", owner: "eng-1", blockedBy: [] },
      { id: "2", subject: "Task B", status: "completed", owner: "eng-2", blockedBy: [] },
      { id: "3", subject: "Task C", status: "in_progress", owner: "eng-1", blockedBy: [] },
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
  };

  it("includes sprint name, cycle, task stats, and commits", async () => {
    // upstream branch
    mockSuccess("origin/main\n");
    // git log
    mockSuccess("abc1234 fix: do thing\ndef5678 feat: add other thing\n");

    const summary = await generatePRSummary(baseState, CWD);

    expect(summary).toContain("alpha");
    expect(summary).toContain("Cycle 1");
    expect(summary).toContain("2/3 completed");
    expect(summary).toContain("abc1234 fix: do thing");
    expect(summary).toContain("def5678 feat: add other thing");
  });

  it("falls back to 'main' when upstream is unavailable", async () => {
    // upstream fails
    mockFailure();
    // git log with fallback base
    mockSuccess("abc1234 chore: update\n");

    const summary = await generatePRSummary(baseState, CWD);

    expect(summary).toContain("alpha");
    expect(summary).toContain("2/3 completed");
  });

  it("shows placeholder when there are no commits", async () => {
    mockSuccess("origin/main\n");
    mockSuccess("");

    const summary = await generatePRSummary(baseState, CWD);

    expect(summary).toContain("_No commits on sprint branch_");
  });
});
