import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { SprintState, TaskInfo } from "./state.js";
import type { GitHubConfig } from "./github.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `tc-github-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSprintYml(dir: string, content: string) {
  writeFileSync(join(dir, ".sprint.yml"), content, "utf-8");
}

const baseState: SprintState = {
  teamName: "sprint-20260101",
  projectName: "my-project",
  agents: [],
  tasks: [],
  messages: [],
  paused: false,
  escalation: null,
  mergeConflict: null,
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
};

const baseTask: TaskInfo = {
  id: "1",
  subject: "Fix the login bug",
  status: "pending",
  owner: "",
  blockedBy: [],
  description: "Users can't log in on mobile",
};

const validConfig: GitHubConfig = {
  repo: "myorg/myrepo",
  token: "ghp_test_token",
  prNumber: 42,
};

// ─── loadGitHubConfig ─────────────────────────────────────────────────────────

describe("loadGitHubConfig", () => {
  let dir: string;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    dir = makeTmpDir();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalToken !== undefined) {
      process.env.GITHUB_TOKEN = originalToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("returns null when no .sprint.yml", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    expect(loadGitHubConfig(dir)).toBeNull();
  });

  it("returns null when no github section", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    writeSprintYml(dir, "agents:\n  model: sonnet\n");
    expect(loadGitHubConfig(dir)).toBeNull();
  });

  it("returns null when repo is missing", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    process.env.GITHUB_TOKEN = "tok";
    writeSprintYml(dir, "github:\n  pr_number: 1\n");
    expect(loadGitHubConfig(dir)).toBeNull();
  });

  it("returns null when GITHUB_TOKEN env is not set", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    writeSprintYml(dir, "github:\n  repo: owner/repo\n");
    expect(loadGitHubConfig(dir)).toBeNull();
  });

  it("returns null for invalid repo format", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    process.env.GITHUB_TOKEN = "tok";
    writeSprintYml(dir, "github:\n  repo: not-a-valid-repo-format-without-slash\n");
    // Wait — "not-a-valid-repo-format-without-slash" has no slash so it's invalid
    expect(loadGitHubConfig(dir)).toBeNull();
  });

  it("returns config when repo and GITHUB_TOKEN are set", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    process.env.GITHUB_TOKEN = "ghp_mytoken";
    writeSprintYml(dir, "github:\n  repo: myorg/myrepo\n");
    const cfg = loadGitHubConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg!.repo).toBe("myorg/myrepo");
    expect(cfg!.token).toBe("ghp_mytoken");
    expect(cfg!.prNumber).toBeUndefined();
  });

  it("parses optional pr_number", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    process.env.GITHUB_TOKEN = "tok";
    writeSprintYml(dir, "github:\n  repo: myorg/myrepo\n  pr_number: 99\n");
    const cfg = loadGitHubConfig(dir);
    expect(cfg!.prNumber).toBe(99);
  });

  it("strips quotes from repo value", async () => {
    const { loadGitHubConfig } = await import("./github.js");
    process.env.GITHUB_TOKEN = "tok";
    writeSprintYml(dir, 'github:\n  repo: "myorg/myrepo"\n');
    const cfg = loadGitHubConfig(dir);
    expect(cfg!.repo).toBe("myorg/myrepo");
  });
});

// ─── createIssueForTask ───────────────────────────────────────────────────────

describe("createIssueForTask", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the correct GitHub issues endpoint", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 10 }),
    } as Response);

    await createIssueForTask(baseTask, validConfig);

    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/myorg/myrepo/issues");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.title).toContain("Fix the login bug");
    expect(body.body).toContain("Users can't log in on mobile");
  });

  it("includes Authorization header with Bearer token", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 11 }),
    } as Response);

    await createIssueForTask(baseTask, validConfig);

    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer ghp_test_token");
  });

  it("returns the issue number on success", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 7 }),
    } as Response);

    const num = await createIssueForTask(baseTask, validConfig);
    expect(num).toBe(7);
  });

  it("returns null on HTTP error without throwing", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: "Validation Failed" }),
    } as Response);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createIssueForTask(baseTask, validConfig);
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("returns null on network error without throwing", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createIssueForTask(baseTask, validConfig);
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("uses task description in issue body when provided", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 1 }),
    } as Response);

    await createIssueForTask(baseTask, validConfig);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toContain("Users can't log in on mobile");
  });

  it("falls back gracefully when task has no description", async () => {
    const { createIssueForTask } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ number: 2 }),
    } as Response);

    const taskNoDesc: TaskInfo = { ...baseTask, description: undefined };
    await createIssueForTask(taskNoDesc, validConfig);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toContain("Auto-created by TeamClaude");
  });
});

// ─── createIssuesForSprint ────────────────────────────────────────────────────

describe("createIssuesForSprint", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates issues for all non-deleted tasks", async () => {
    const { createIssuesForSprint } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ number: 1 }),
    } as Response);

    const tasks: TaskInfo[] = [
      { id: "1", subject: "Task A", status: "pending", owner: "", blockedBy: [] },
      { id: "2", subject: "Task B", status: "in_progress", owner: "eng", blockedBy: [] },
      { id: "3", subject: "Deleted task", status: "deleted", owner: "", blockedBy: [] },
    ];

    await createIssuesForSprint(tasks, validConfig);
    // Should create 2 issues (not deleted)
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("skips deleted tasks", async () => {
    const { createIssuesForSprint } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ number: 1 }),
    } as Response);

    const tasks: TaskInfo[] = [
      { id: "1", subject: "Deleted", status: "deleted", owner: "", blockedBy: [] },
    ];

    await createIssuesForSprint(tasks, validConfig);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── commentOnPR ──────────────────────────────────────────────────────────────

describe("commentOnPR", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the correct PR comments endpoint", async () => {
    const { commentOnPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 555 }),
    } as Response);

    await commentOnPR(42, "Hello PR", validConfig);

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/myorg/myrepo/issues/42/comments");
  });

  it("sends the comment body", async () => {
    const { commentOnPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    } as Response);

    await commentOnPR(42, "My comment body", validConfig);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toBe("My comment body");
  });

  it("returns comment ID on success", async () => {
    const { commentOnPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 999 }),
    } as Response);

    const id = await commentOnPR(42, "x", validConfig);
    expect(id).toBe(999);
  });

  it("returns null on HTTP failure without throwing", async () => {
    const { commentOnPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
    } as Response);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await commentOnPR(42, "x", validConfig);
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("returns null on network error without throwing", async () => {
    const { commentOnPR } = await import("./github.js");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await commentOnPR(42, "x", validConfig);
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});

// ─── postRetroToPR ────────────────────────────────────────────────────────────

describe("postRetroToPR", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the retro markdown to the configured PR", async () => {
    const { postRetroToPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    } as Response);

    await postRetroToPR("# Sprint Retro\nAll done!", validConfig);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toBe("# Sprint Retro\nAll done!");
  });

  it("no-ops when config has no prNumber", async () => {
    const { postRetroToPR } = await import("./github.js");
    const cfgNoPR: GitHubConfig = { repo: "org/repo", token: "tok" };
    await postRetroToPR("retro", cfgNoPR);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── postSprintStatusToPR ─────────────────────────────────────────────────────

describe("postSprintStatusToPR", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a status comment with task completion info", async () => {
    const { postSprintStatusToPR } = await import("./github.js");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    } as Response);

    const stateWithTasks: SprintState = {
      ...baseState,
      tasks: [
        { id: "1", subject: "A", status: "completed", owner: "eng", blockedBy: [] },
        { id: "2", subject: "B", status: "in_progress", owner: "eng", blockedBy: [] },
      ],
    };

    await postSprintStatusToPR(stateWithTasks, validConfig);

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.body).toContain("1/2");
    expect(body.body).toContain("50%");
  });

  it("no-ops when config has no prNumber", async () => {
    const { postSprintStatusToPR } = await import("./github.js");
    const cfgNoPR: GitHubConfig = { repo: "org/repo", token: "tok" };
    await postSprintStatusToPR(baseState, cfgNoPR);
    expect(fetch).not.toHaveBeenCalled();
  });
});
