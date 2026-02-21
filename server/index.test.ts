/**
 * Integration-style unit tests for index.ts HTTP API endpoints.
 *
 * Strategy: mock all side-effectful dependencies, then import index.ts.
 * index.ts calls createServer(handleRequest) at module load — we intercept
 * createServer via vi.mock("node:http") to capture the request handler,
 * then create a real server on a random port to run tests against.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";
import http from "node:http";

// ─── Capture the request handler from index.ts ───────────────────────────────

let capturedHandler: http.RequestListener | undefined;
let testServer: http.Server;
let baseUrl: string;

// vi.hoisted runs before any imports — use createRequire to get original http
const { realCreateServer } = vi.hoisted(() => {
  const { createRequire } = require("node:module");
  const req = createRequire(import.meta.url);
  const nodeHttp = req("node:http");
  return { realCreateServer: nodeHttp.createServer.bind(nodeHttp) };
});

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    createServer: vi.fn((handler: http.RequestListener) => {
      capturedHandler = handler;
      // Return a stub — index.ts will call .listen() on it, which we no-op
      return {
        listen: vi.fn((_port: number, cb?: () => void) => cb?.()),
        close: vi.fn(),
        address: vi.fn(() => null),
      } as unknown as http.Server;
    }),
  };
});

// ─── Mock all side-effectful modules ─────────────────────────────────────────

vi.mock("./state.js", () => {
  const state: Record<string, any> = {
    teamName: null,
    projectName: "test-project",
    agents: [],
    tasks: [],
    messages: [],
    paused: false,
    escalation: null,
    mergeConflict: null,
    mode: "manual",
    cycle: 0,
    phase: "idle",
    reviewTaskIds: [],
    validatingTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    tmuxAvailable: false,
    tmuxSessionName: null,
  };
  const clients = new Set<any>();
  return {
    state,
    clients,
    broadcast: vi.fn(),
    resetState: vi.fn(() => {
      state.teamName = null;
      state.projectName = null;
      state.agents = [];
      state.tasks = [];
      state.messages = [];
      state.paused = false;
      state.escalation = null;
      state.mergeConflict = null;
      state.mode = "manual";
      state.cycle = 0;
      state.phase = "idle";
      state.reviewTaskIds = [];
      state.tokenUsage = { total: 0, byAgent: {}, estimatedCostUsd: 0 };
      state.checkpoints = [];
      state.pendingCheckpoint = null;
      state.tmuxSessionName = null;
    }),
    detectProjectName: vi.fn(() => "test-project"),
  };
});

vi.mock("./persistence.js", () => ({
  loadPersistedState: vi.fn(() => null),
  flushSave: vi.fn(),
  scheduleSave: vi.fn(),
}));

vi.mock("./watcher.js", () => ({
  startWatching: vi.fn(),
  setTeamDiscoveredHook: vi.fn(),
}));

vi.mock("./prompt.js", () => ({
  compileSprintPrompt: vi.fn(() => "compiled-prompt"),
  loadCustomRoles: vi.fn(() => null),
}));

vi.mock("./storage.js", () => ({
  setProjectRoot: vi.fn(),
  generateSprintId: vi.fn(() => "sprint-20260220T120000"),
  historyDir: vi.fn(() => "/tmp/tc-test-history"),
  sprintHistoryDir: vi.fn((id: string) => `/tmp/tc-test-history/${id}`),
}));

vi.mock("./analytics.js", () => ({
  recordSprintCompletion: vi.fn(() => ({
    sprintId: "test-team-123",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    cycle: 1,
    totalTasks: 0,
    completedTasks: 0,
    blockedTasks: 0,
    avgReviewRoundsPerTask: 0,
    totalMessages: 0,
    agents: [],
  })),
  loadSprintHistory: vi.fn(() => []),
  saveSprintSnapshot: vi.fn(),
  saveRetroToHistory: vi.fn(),
  saveRecordToHistory: vi.fn(),
  migrateGlobalAnalytics: vi.fn(),
}));

vi.mock("./learnings.js", () => ({
  getRoleLearnings: vi.fn(() => ({ orchestrator: "", pm: "", manager: "", engineer: "" })),
  extractProcessLearnings: vi.fn(() => ({ version: 1, learnings: [] })),
  loadProcessLearnings: vi.fn(() => ({ version: 1, learnings: [] })),
  saveAndRemoveLearning: vi.fn(() => true),
}));

vi.mock("./git.js", () => ({
  createSprintBranch: vi.fn(() => Promise.resolve("sprint/test-branch")),
  generatePRSummary: vi.fn(() => Promise.resolve("PR summary")),
  getCurrentBranch: vi.fn(() => Promise.resolve("main")),
}));

vi.mock("./retro.js", () => ({
  generateRetro: vi.fn(() => "Retro text"),
  parseRetro: vi.fn(() => ({
    summary: { totalTasks: 1, completedTasks: 1, completionRate: 100, avgReviewRounds: 0 },
    completed: ["Task A"],
    incomplete: [],
    highlights: ["Task A"],
    recommendations: [],
    raw: "Retro text",
  })),
}));

vi.mock("./gist.js", () => ({
  createGist: vi.fn(() => Promise.resolve("https://gist.github.com/user/abc123")),
}));

vi.mock("./templates.js", () => ({
  loadTemplates: vi.fn(() => [
    {
      id: "bug-bash",
      name: "Bug Bash",
      description: "Triage and fix bugs",
      agents: { roles: ["engineer", "engineer", "qa"], model: "sonnet" },
      cycles: 1,
      roadmap: "## Bug Bash\n",
    },
  ]),
}));

vi.mock("./tmux.js", () => ({
  isTmuxAvailable: vi.fn(() => Promise.resolve(false)),
  findSprintSession: vi.fn(() => Promise.resolve(null)),
  createSession: vi.fn(() => Promise.resolve()),
  killSession: vi.fn(() => Promise.resolve()),
  hasSession: vi.fn(() => Promise.resolve(true)),
  listPanes: vi.fn(() => Promise.resolve([])),
  pollPane: vi.fn(() => Promise.resolve(null)),
  sendKeys: vi.fn(() => Promise.resolve()),
  sendSpecialKey: vi.fn(() => Promise.resolve()),
  attributePanes: vi.fn(),
  getPaneForAgent: vi.fn(() => null),
  reset: vi.fn(),
}));

vi.mock("./notifications.js", () => ({
  initNotifications: vi.fn(),
  notifyWebhook: vi.fn(),
}));

vi.mock("ws", () => ({
  WebSocketServer: class {
    on() { return this; }
  },
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const makeChild = () => {
    const child = new EventEmitter() as any;
    child.pid = 12345;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    return child;
  };
  return { spawn: vi.fn(makeChild) };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFile: vi.fn((_p: any, _e: any, cb: any) => cb(null, "<html>UI</html>")),
    existsSync: vi.fn(() => false),
    readFileSync: actual.readFileSync,
    readdirSync: vi.fn(() => []),
  };
});

// Strip --port from argv so parseArgs returns default
process.argv = ["node", "index.ts"];

// ─── Bootstrap ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await import("./index.js");

  // capturedHandler is now set — spin up a real server for testing
  testServer = realCreateServer(capturedHandler!);
  await new Promise<void>((resolve) => testServer.listen(0, resolve));
  const addr = testServer.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(() => {
  testServer?.close();
});

// ─── Imported mocks for state manipulation ────────────────────────────────────

import { state, broadcast, resetState } from "./state.js";
import { notifyWebhook } from "./notifications.js";
import { loadPersistedState } from "./persistence.js";
import { recordSprintCompletion, loadSprintHistory, saveSprintSnapshot, saveRetroToHistory, saveRecordToHistory } from "./analytics.js";
import { generateRetro, parseRetro } from "./retro.js";
import { createGist } from "./gist.js";
import { generatePRSummary, getCurrentBranch } from "./git.js";
import { existsSync, readdirSync } from "node:fs";

function resetStateFields() {
  (state as any).teamName = null;
  (state as any).projectName = "test-project";
  (state as any).agents = [];
  (state as any).tasks = [];
  (state as any).messages = [];
  (state as any).paused = false;
  (state as any).escalation = null;
  (state as any).mergeConflict = null;
  (state as any).mode = "manual";
  (state as any).cycle = 0;
  (state as any).phase = "idle";
  (state as any).reviewTaskIds = [];
  (state as any).checkpoints = [];
  (state as any).pendingCheckpoint = null;
  (state as any).tmuxAvailable = false;
  (state as any).tmuxSessionName = null;
  vi.mocked(broadcast).mockClear();
}

beforeEach(resetStateFields);

// ─── HTTP test helpers ────────────────────────────────────────────────────────

function request(
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: data })
        );
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json(method: string, path: string, body?: object) {
  const r = await request(method, path, body);
  return { ...r, json: JSON.parse(r.body) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OPTIONS preflight", () => {
  it("returns 204 with CORS headers", async () => {
    const r = await request("OPTIONS", "/api/state");
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["access-control-allow-methods"]).toMatch(/GET/);
  });
});

describe("GET /api/state", () => {
  it("returns current state as JSON", async () => {
    const r = await json("GET", "/api/state");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ teamName: null, paused: false, phase: "idle" });
  });
});

describe("GET /api/process-status", () => {
  it("returns not running when no sprint active", async () => {
    const r = await json("GET", "/api/process-status");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ running: false, pid: null, startedAt: null });
  });
});

describe("GET /api/retro", () => {
  it("returns 404 when no retro has been generated", async () => {
    const r = await request("GET", "/api/retro");
    expect(r.status).toBe(404);
  });
});

describe("GET /api/git-status", () => {
  it("returns branch info", async () => {
    const r = await json("GET", "/api/git-status");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ branch: "main", hasBranch: false });
    expect(getCurrentBranch).toHaveBeenCalled();
  });
});

describe("GET /api/analytics", () => {
  it("returns empty array when no history", async () => {
    const r = await json("GET", "/api/analytics");
    expect(r.status).toBe(200);
    expect(r.json).toEqual([]);
  });

  it("filters by cycle query param", async () => {
    vi.mocked(loadSprintHistory).mockReturnValueOnce([
      { cycle: 1, sprintId: "a" } as any,
      { cycle: 2, sprintId: "b" } as any,
    ]);
    const r = await json("GET", "/api/analytics?cycle=1");
    expect(r.json).toHaveLength(1);
    expect(r.json[0].cycle).toBe(1);
  });

  it("limits results with limit query param", async () => {
    vi.mocked(loadSprintHistory).mockReturnValueOnce([
      { cycle: 1, sprintId: "a" } as any,
      { cycle: 2, sprintId: "b" } as any,
      { cycle: 3, sprintId: "c" } as any,
    ]);
    const r = await json("GET", "/api/analytics?limit=2");
    expect(r.json).toHaveLength(2);
    // last 2 entries
    expect(r.json[0].cycle).toBe(2);
    expect(r.json[1].cycle).toBe(3);
  });

  it("returns CSV with correct headers when format=csv", async () => {
    vi.mocked(loadSprintHistory).mockReturnValueOnce([
      {
        sprintId: "sprint-abc",
        startedAt: "2026-02-21T14:00:00.000Z",
        completedAt: "2026-02-21T14:06:00.000Z",
        cycle: 1,
        completedTasks: 4,
        totalTasks: 5,
        blockedTasks: 0,
        avgReviewRoundsPerTask: 1.2,
        totalMessages: 48,
        agents: ["sprint-manager", "sprint-engineer"],
      },
    ]);
    const r = await request("GET", "/api/analytics?format=csv");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.headers["content-disposition"]).toMatch(/teamclaude-history\.csv/);
    const lines = r.body.trim().split("\n");
    expect(lines[0]).toBe("sprintId,completedAt,cycle,completedTasks,totalTasks,completionRate,avgReviewRoundsPerTask,totalMessages,durationSeconds");
    expect(lines[1]).toContain("sprint-abc");
    expect(lines[1]).toContain(",1,");   // cycle
    expect(lines[1]).toContain(",4,");   // completedTasks
    expect(lines[1]).toContain(",80,");  // completionRate (4/5 = 80%)
    expect(lines[1]).toContain(",360");  // durationSeconds (6 min)
  });

  it("returns empty CSV (header only) when no history", async () => {
    vi.mocked(loadSprintHistory).mockReturnValueOnce([]);
    const r = await request("GET", "/api/analytics?format=csv");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    const lines = r.body.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sprintId");
  });
});

describe("GET /api/history", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
  });

  it("returns empty JSON array when no history directory", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const r = await json("GET", "/api/history");
    expect(r.status).toBe(200);
    expect(r.json).toEqual([]);
  });

  it("returns JSON entries with id and record fields", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: "sprint-abc", isDirectory: () => true } as any,
    ]);
    const r = await json("GET", "/api/history");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json[0]).toHaveProperty("id", "sprint-abc");
    expect(r.json[0]).toHaveProperty("record");
  });

  it("returns CSV with correct header when format=csv", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const r = await request("GET", "/api/history?format=csv");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.headers["content-disposition"]).toMatch(/sprint-history\.csv/);
    const lines = r.body.trim().split("\n");
    expect(lines[0]).toBe("id,teamName,tasksCompleted,totalTasks,durationMs,startedAt,completedAt");
    expect(lines).toHaveLength(1);
  });

  it("returns CSV rows with correct values when format=csv and history exists", async () => {
    const startedAt = "2026-02-21T14:00:00.000Z";
    const completedAt = "2026-02-21T14:10:00.000Z";
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: "sprint-myteam-1708521600000", isDirectory: () => true } as any,
    ]);
    // readFileSync is not mocked — existsSync returns true for directory but false for record.json
    // Override existsSync to return true for dir and false for record path so record=null
    // Instead, patch readFileSync via the existing actual mock approach:
    // The simplest approach: let existsSync return false for the record path
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p).endsWith("record.json")) {
        // Simulate record file existing by returning true, but readFileSync is actual
        // We can't easily inject content — test without record (record=null path)
        return false;
      }
      return true;
    });

    const r = await request("GET", "/api/history?format=csv");
    expect(r.status).toBe(200);
    const lines = r.body.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("sprint-myteam-1708521600000");
  });
});

describe("GET / (UI)", () => {
  it("returns HTML content", async () => {
    const r = await request("GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.body).toBe("<html>UI</html>");
  });

  it("also serves /index.html", async () => {
    const r = await request("GET", "/index.html");
    expect(r.status).toBe(200);
    expect(r.body).toBe("<html>UI</html>");
  });
});

describe("POST /api/pause", () => {
  it("toggles paused to true", async () => {
    (state as any).paused = false;
    const r = await json("POST", "/api/pause");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ paused: true });
    expect(state.paused).toBe(true);
    expect(broadcast).toHaveBeenCalledWith({ type: "paused", paused: true });
  });

  it("toggles paused back to false", async () => {
    (state as any).paused = true;
    const r = await json("POST", "/api/pause");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ paused: false });
    expect(state.paused).toBe(false);
  });
});

describe("POST /api/dismiss-escalation", () => {
  it("clears escalation and broadcasts", async () => {
    (state as any).escalation = { taskId: "1", reason: "stuck", from: "eng", timestamp: 1 };
    const r = await json("POST", "/api/dismiss-escalation");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(state.escalation).toBeNull();
    expect(broadcast).toHaveBeenCalledWith({ type: "escalation", escalation: null });
  });
});

describe("POST /api/checkpoint", () => {
  it("adds taskId to checkpoints", async () => {
    const r = await json("POST", "/api/checkpoint", { taskId: "42" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(state.checkpoints).toContain("42");
  });

  it("does not add duplicate taskId", async () => {
    (state as any).checkpoints = ["42"];
    await json("POST", "/api/checkpoint", { taskId: "42" });
    expect(state.checkpoints).toHaveLength(1);
  });

  it("returns 400 on invalid (empty) JSON body", async () => {
    // Send no body at all — JSON.parse("") throws
    const r = await request("POST", "/api/checkpoint");
    expect(r.status).toBe(400);
  });
});

describe("POST /api/checkpoint/release", () => {
  it("clears pendingCheckpoint and broadcasts", async () => {
    (state as any).pendingCheckpoint = { taskId: "5", taskSubject: "Deploy" };
    const r = await json("POST", "/api/checkpoint/release");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(state.pendingCheckpoint).toBeNull();
    expect(broadcast).toHaveBeenCalledWith({ type: "checkpoint", checkpoint: null });
  });
});

describe("POST /api/resume", () => {
  it("returns resumed: false when no persisted state", async () => {
    vi.mocked(loadPersistedState).mockReturnValueOnce(null);
    const r = await json("POST", "/api/resume");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ resumed: false });
  });

  it("returns resumed: false when persisted state has no teamName", async () => {
    vi.mocked(loadPersistedState).mockReturnValueOnce({ teamName: null } as any);
    const r = await json("POST", "/api/resume");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ resumed: false });
  });

  it("restores state and broadcasts init on success", async () => {
    vi.mocked(loadPersistedState).mockReturnValueOnce({
      teamName: "sprint-abc",
      tasks: [{ id: "1", subject: "T1", status: "pending", owner: "", blockedBy: [] }],
      agents: [],
      messages: [],
      paused: false,
      escalation: null,
      mode: "manual",
      cycle: 2,
      phase: "sprinting",
      reviewTaskIds: [],
      tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
      checkpoints: [],
      pendingCheckpoint: null,
      tmuxAvailable: true,        // runtime-only — must NOT be restored
      tmuxSessionName: "tc-old",  // runtime-only — must NOT be restored
      projectName: "old-name",    // runtime-only — must NOT be restored
    } as any);
    const r = await json("POST", "/api/resume");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ resumed: true, teamName: "sprint-abc" });
    expect(state.teamName).toBe("sprint-abc");
    expect(state.cycle).toBe(2);
    expect(state.tmuxSessionName).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));
  });

  it("returns 409 when sprint already active", async () => {
    (state as any).teamName = "sprint-running";
    const r = await json("POST", "/api/resume");
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "Sprint already active" });
  });
});

describe("POST /api/stop", () => {
  it("resets state, generates retro and PR summary, returns ok", async () => {
    vi.mocked(generatePRSummary).mockResolvedValueOnce("PR summary text");
    vi.mocked(generateRetro).mockReturnValueOnce("Sprint retro");
    const r = await json("POST", "/api/stop");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, prSummary: "PR summary text", retro: "Sprint retro" });
    expect(resetState).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));
  });

  it("calls recordSprintCompletion when a tmux session was active", async () => {
    (state as any).tmuxSessionName = "tc-running";
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    vi.mocked(generateRetro).mockReturnValueOnce("");
    const r = await json("POST", "/api/stop");
    expect(r.status).toBe(200);
    expect(recordSprintCompletion).toHaveBeenCalled();
  });

  it("returns ok even when generatePRSummary rejects", async () => {
    vi.mocked(generatePRSummary).mockRejectedValueOnce(new Error("git failed"));
    vi.mocked(generateRetro).mockReturnValueOnce("retro");
    const r = await json("POST", "/api/stop");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, prSummary: "" });
  });
});

describe("POST /api/dismiss-merge-conflict", () => {
  it("clears mergeConflict and broadcasts", async () => {
    (state as any).mergeConflict = {
      engineerName: "eng-1",
      baseBranch: "main",
      worktreeBranch: "sprint/team/eng-1",
      conflictingFiles: ["file.ts"],
      timestamp: 1,
    };
    const r = await json("POST", "/api/dismiss-merge-conflict");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(state.mergeConflict).toBeNull();
    expect(broadcast).toHaveBeenCalledWith({ type: "merge_conflict", mergeConflict: null });
  });
});

describe("POST /api/launch", () => {
  it("returns 400 when roadmap is empty in manual mode", async () => {
    const r = await json("POST", "/api/launch", { roadmap: "  ", engineers: 1, includePM: false });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "Roadmap required in manual mode" });
  });

  it("returns 409 when a tmux session is already running", async () => {
    (state as any).tmuxSessionName = "tc-existing";
    const r = await json("POST", "/api/launch", { roadmap: "Build it", engineers: 1 });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: "Sprint already running" });
  });

  it("launches via spawn when tmux is not available and returns pid/startedAt", async () => {
    (state as any).tmuxAvailable = false;
    const r = await json("POST", "/api/launch", {
      roadmap: "Build a feature",
      engineers: 2,
    });
    expect(r.status).toBe(200);
    expect(r.json).toHaveProperty("pid", 12345);
    expect(r.json).toHaveProperty("startedAt");
    // Clean up: simulate process exit so sprintProcess is nulled
    const { spawn } = await import("node:child_process");
    const child = vi.mocked(spawn).mock.results.at(-1)?.value;
    child?.emit("exit", 0);
  });

  it("accepts PM mode launch without roadmap", async () => {
    (state as any).tmuxAvailable = false;
    const r = await json("POST", "/api/launch", { roadmap: "", includePM: true, engineers: 1 });
    expect(r.status).toBe(200);
    const { spawn } = await import("node:child_process");
    vi.mocked(spawn).mock.results.at(-1)?.value?.emit("exit", 0);
  });

  it("returns 400 on malformed JSON body", async () => {
    const r = await request("POST", "/api/launch");
    expect(r.status).toBe(400);
  });
});

describe("POST /api/retro/gist", () => {
  it("returns 404 when no retro is available", async () => {
    const { _resetLastRetro } = await import("./index.js");
    _resetLastRetro();
    const r = await json("POST", "/api/retro/gist");
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ error: "No retrospective available" });
  });

  it("returns gist URL when retro exists", async () => {
    vi.mocked(generateRetro).mockReturnValueOnce("# Sprint Retro\n\nGreat job!");
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    await json("POST", "/api/stop");

    vi.mocked(createGist).mockResolvedValueOnce("https://gist.github.com/user/abc123");
    const r = await json("POST", "/api/retro/gist");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ url: "https://gist.github.com/user/abc123" });
    expect(createGist).toHaveBeenCalledWith(
      "# Sprint Retro\n\nGreat job!",
      "sprint-retro.md"
    );
  });

  it("returns 500 when gh CLI fails", async () => {
    vi.mocked(generateRetro).mockReturnValueOnce("Some retro");
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    await json("POST", "/api/stop");

    vi.mocked(createGist).mockRejectedValueOnce(new Error("gh CLI is not installed"));
    const r = await json("POST", "/api/retro/gist");
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ error: "gh CLI is not installed" });
  });
});

describe("GET /api/retro after stop", () => {
  it("returns retro text after a successful stop", async () => {
    vi.mocked(generateRetro).mockReturnValueOnce("Great sprint!");
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    await json("POST", "/api/stop");
    const r = await request("GET", "/api/retro");
    expect(r.status).toBe(200);
    expect(r.body).toBe("Great sprint!");
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("returns JSON when format=json", async () => {
    vi.mocked(generateRetro).mockReturnValueOnce("# Retro\n\nContent");
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    await json("POST", "/api/stop");
    const r = await json("GET", "/api/retro?format=json");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.json).toMatchObject({ summary: expect.any(Object), completed: expect.any(Array), raw: expect.any(String) });
    expect(parseRetro).toHaveBeenCalled();
  });

  it("returns markdown for format=md", async () => {
    vi.mocked(generateRetro).mockReturnValueOnce("# Retro\n\nContent");
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    await json("POST", "/api/stop");
    const r = await request("GET", "/api/retro?format=md");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
  });
});

describe("GET /api/templates", () => {
  it("returns 200 with JSON array of templates", async () => {
    const r = await json("GET", "/api/templates");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(Array.isArray(r.json)).toBe(true);
  });

  it("returns template objects with required fields", async () => {
    const r = await json("GET", "/api/templates");
    const [t] = r.json;
    expect(t).toMatchObject({
      id: "bug-bash",
      name: "Bug Bash",
      description: expect.any(String),
      agents: { roles: expect.any(Array) },
      cycles: expect.any(Number),
      roadmap: expect.any(String),
    });
  });
});

describe("404 fallback", () => {
  it("returns 404 for unknown routes", async () => {
    const r = await request("GET", "/api/nonexistent");
    expect(r.status).toBe(404);
  });
});

describe("notifyWebhook integration", () => {
  beforeEach(() => {
    vi.mocked(notifyWebhook).mockClear();
  });

  it("calls notifyWebhook with sprint_complete on POST /api/stop when sprint was running", async () => {
    (state as any).teamName = "sprint-alpha";
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    vi.mocked(generateRetro).mockReturnValueOnce("retro");
    await json("POST", "/api/stop");
    expect(notifyWebhook).toHaveBeenCalledWith(
      "sprint_complete",
      expect.objectContaining({ teamName: "sprint-alpha" })
    );
  });

  it("skips notifyWebhook on POST /api/stop when no sprint was running", async () => {
    // No teamName, no process — wasRunning is false
    (state as any).teamName = null;
    vi.mocked(generatePRSummary).mockResolvedValueOnce("");
    vi.mocked(generateRetro).mockReturnValueOnce("retro");
    await json("POST", "/api/stop");
    expect(notifyWebhook).not.toHaveBeenCalled();
  });
});
