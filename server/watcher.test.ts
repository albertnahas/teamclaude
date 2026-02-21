import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock state module — must be before importing watcher
vi.mock("./state.js", () => {
  const state = {
    teamName: null as string | null,
    projectName: null as string | null,
    agents: [] as any[],
    tasks: [] as any[],
    messages: [] as any[],
    paused: false,
    escalation: null as any,
    mode: "manual" as "manual" | "autonomous",
    cycle: 0,
    phase: "idle" as string,
    reviewTaskIds: [] as string[],
    tokenUsage: { total: 0, byAgent: {} as Record<string, number>, estimatedCostUsd: 0 },
    checkpoints: [] as string[],
    pendingCheckpoint: null as any,
    tmuxAvailable: false,
    tmuxSessionName: null as string | null,
  };

  let _teamInitMessageSent = false;
  const inboxCursors = new Map<string, number>();
  const taskProtocolOverrides = new Map<string, { status: string; owner: string }>();

  const mod = {
    state,
    inboxCursors,
    taskProtocolOverrides,
    get teamInitMessageSent() { return _teamInitMessageSent; },
    setTeamInitMessageSent(v: boolean) { _teamInitMessageSent = v; },
    safeReadJSON: vi.fn(),
    broadcast: vi.fn(),
  };
  return mod;
});

// Mock persistence so broadcast doesn't try to schedule saves
vi.mock("./persistence.js", () => ({ scheduleSave: vi.fn() }));

// Mock verification so SPRINT_COMPLETE/CYCLE_COMPLETE don't run real commands
vi.mock("./verification.js", () => ({ runVerification: vi.fn(() => Promise.resolve({ passed: true, results: [] })) }));

import {
  isSprintTeam,
  setTeamDiscoveredHook,
  handleTeamConfig,
  handleInboxMessage,
  handleTaskFile,
} from "./watcher.js";
import { state, inboxCursors, taskProtocolOverrides, broadcast, safeReadJSON, setTeamInitMessageSent } from "./state.js";

function resetState() {
  state.teamName = null;
  state.projectName = null;
  state.agents = [];
  state.tasks = [];
  state.messages = [];
  state.paused = false;
  state.escalation = null;
  state.mode = "manual";
  state.cycle = 0;
  state.phase = "idle";
  state.reviewTaskIds = [];
  state.tokenUsage = { total: 0, byAgent: {}, estimatedCostUsd: 0 };
  state.checkpoints = [];
  state.pendingCheckpoint = null;
  state.tmuxAvailable = false;
  state.tmuxSessionName = null;
  inboxCursors.clear();
  taskProtocolOverrides.clear();
  vi.mocked(broadcast).mockClear();
  vi.mocked(safeReadJSON).mockClear();
  // Reset teamInitMessageSent so each test starts fresh
  setTeamInitMessageSent(false);
}

// --- isSprintTeam ---

describe("isSprintTeam", () => {
  it("returns false when config has no members", () => {
    expect(isSprintTeam({})).toBe(false);
    expect(isSprintTeam(null)).toBe(false);
  });

  it("returns true when team name starts with 'sprint-'", () => {
    expect(isSprintTeam({ name: "sprint-1234", members: [] })).toBe(true);
  });

  it("returns true for sprint-manager + sprint-engineer combo", () => {
    const config = {
      members: [
        { name: "sprint-manager" },
        { name: "sprint-engineer" },
      ],
    };
    expect(isSprintTeam(config)).toBe(true);
  });

  it("returns true for sprint-manager + numbered sprint-engineer", () => {
    const config = {
      members: [
        { name: "sprint-manager" },
        { name: "sprint-engineer-1" },
        { name: "sprint-engineer-2" },
      ],
    };
    expect(isSprintTeam(config)).toBe(true);
  });

  it("returns false when sprint-manager is present but no engineer", () => {
    expect(isSprintTeam({ members: [{ name: "sprint-manager" }] })).toBe(false);
  });

  it("returns false for unrelated team members", () => {
    expect(isSprintTeam({ members: [{ name: "foo" }, { name: "bar" }] })).toBe(false);
  });
});

// --- handleTeamConfig ---

describe("handleTeamConfig", () => {
  beforeEach(resetState);

  const validConfig = {
    members: [
      { name: "sprint-manager", agentId: "mgr-1", agentType: "manager" },
      { name: "sprint-engineer-1", agentId: "eng-1", agentType: "engineer" },
    ],
  };
  const filePath = "/home/user/.claude/teams/sprint-abc/config.json";

  it("ignores non-sprint configs", () => {
    vi.mocked(safeReadJSON).mockReturnValue({ members: [{ name: "other" }] });
    handleTeamConfig(filePath);
    expect(state.teamName).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("sets teamName from the directory name", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    expect(state.teamName).toBe("sprint-abc");
  });

  it("populates agents with correct shape", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0]).toMatchObject({
      name: "sprint-manager",
      agentId: "mgr-1",
      agentType: "manager",
      status: "active",
    });
  });

  it("sets mode to manual when no sprint-pm present", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    expect(state.mode).toBe("manual");
    expect(state.phase).toBe("idle");
  });

  it("sets mode to autonomous and phase to analyzing when sprint-pm present", () => {
    const pmConfig = {
      members: [
        { name: "sprint-manager", agentId: "mgr-1", agentType: "manager" },
        { name: "sprint-pm", agentId: "pm-1", agentType: "pm" },
        { name: "sprint-engineer-1", agentId: "eng-1", agentType: "engineer" },
      ],
    };
    // Name starts with "sprint-" so isSprintTeam returns true via name check
    const pmPath = "/home/user/.claude/teams/sprint-pm-team/config.json";
    vi.mocked(safeReadJSON).mockReturnValue({ name: "sprint-pm-team", ...pmConfig });
    handleTeamConfig(pmPath);
    expect(state.mode).toBe("autonomous");
    expect(state.phase).toBe("analyzing");
  });

  it("broadcasts init event", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));
  });

  it("sends system init message and it comes from 'system'", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].from).toBe("system");
    expect(state.messages[0].to).toBe("all");
  });

  it("calls onTeamDiscovered hook with agent names", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    const hook = vi.fn();
    setTeamDiscoveredHook(hook);
    handleTeamConfig(filePath);
    expect(hook).toHaveBeenCalledWith(["sprint-manager", "sprint-engineer-1"]);
    setTeamDiscoveredHook(() => {}); // reset hook
  });

  it("sends the system init message only once even when config fires twice", () => {
    vi.mocked(safeReadJSON).mockReturnValue(validConfig);
    handleTeamConfig(filePath);
    handleTeamConfig(filePath);
    const sysMsgs = state.messages.filter((m: any) => m.from === "system");
    expect(sysMsgs).toHaveLength(1);
  });
});

// --- handleTaskFile ---

describe("handleTaskFile", () => {
  beforeEach(() => {
    resetState();
    state.teamName = "sprint-abc";
  });

  const filePath = "/home/user/.claude/tasks/sprint-abc/tasks.json";

  it("ignores when teamName is null", () => {
    state.teamName = null;
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "1", subject: "Do thing", status: "pending" }]);
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(0);
  });

  it("ignores when file path does not include teamName", () => {
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "1", subject: "Do thing" }]);
    handleTaskFile("/home/user/.claude/tasks/other-team/tasks.json");
    expect(state.tasks).toHaveLength(0);
  });

  it("adds new tasks from array", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { id: "1", subject: "Task one", status: "pending", owner: "eng-1", blockedBy: [] },
      { id: "2", subject: "Task two", status: "in_progress", owner: "eng-2", blockedBy: ["1"] },
    ]);
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0].id).toBe("1");
    expect(state.tasks[1].blockedBy).toEqual(["1"]);
  });

  it("adds a single task object (not array)", () => {
    vi.mocked(safeReadJSON).mockReturnValue({ id: "3", subject: "Solo task" });
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("3");
  });

  it("updates existing task by id", () => {
    state.tasks = [{ id: "1", subject: "Old", status: "pending", owner: "", blockedBy: [] }];
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "1", subject: "Updated", status: "in_progress" }]);
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].subject).toBe("Updated");
    expect(state.tasks[0].status).toBe("in_progress");
  });

  it("skips tasks with agent names as subject", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { id: "10", subject: "sprint-manager" },
      { id: "11", subject: "sprint-engineer" },
      { id: "12", subject: "sprint-engineer-3" },
      { id: "13", subject: "sprint-pm" },
      { id: "14", subject: "Real task" },
    ]);
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].subject).toBe("Real task");
  });

  it("skips tasks without an id", () => {
    vi.mocked(safeReadJSON).mockReturnValue([{ subject: "No id task" }]);
    handleTaskFile(filePath);
    expect(state.tasks).toHaveLength(0);
  });

  it("broadcasts task_updated for each task", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { id: "1", subject: "T1" },
      { id: "2", subject: "T2" },
    ]);
    handleTaskFile(filePath);
    const calls = vi.mocked(broadcast).mock.calls.map((c) => c[0]);
    const taskUpdates = calls.filter((e) => e.type === "task_updated");
    expect(taskUpdates).toHaveLength(2);
  });

  it("applies protocol override when override status ranks higher", () => {
    taskProtocolOverrides.set("5", { status: "in_progress", owner: "eng-1" });
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "5", subject: "Task 5", status: "pending" }]);
    handleTaskFile(filePath);
    expect(state.tasks[0].status).toBe("in_progress");
    expect(state.tasks[0].owner).toBe("eng-1");
  });

  it("does not downgrade status via protocol override", () => {
    taskProtocolOverrides.set("6", { status: "pending", owner: "" });
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "6", subject: "Task 6", status: "completed" }]);
    handleTaskFile(filePath);
    expect(state.tasks[0].status).toBe("completed");
  });

  it("removes from reviewTaskIds when task is completed", () => {
    state.reviewTaskIds = ["7", "8"];
    vi.mocked(safeReadJSON).mockReturnValue([{ id: "7", subject: "Task 7", status: "completed" }]);
    handleTaskFile(filePath);
    expect(state.reviewTaskIds).toEqual(["8"]);
  });
});

// --- handleInboxMessage ---

describe("handleInboxMessage", () => {
  beforeEach(() => {
    resetState();
    state.teamName = "sprint-abc";
    state.agents = [
      { name: "sprint-manager", agentId: "mgr-1", agentType: "manager", status: "active" },
      { name: "sprint-engineer-1", agentId: "eng-1", agentType: "engineer", status: "idle" },
    ];
  });

  const inboxPath = "/home/user/.claude/teams/sprint-abc/inboxes/sprint-engineer-1.json";

  it("ignores when teamName is null", () => {
    state.teamName = null;
    vi.mocked(safeReadJSON).mockReturnValue([{ from: "sprint-manager", content: "hi" }]);
    handleInboxMessage(inboxPath);
    expect(state.messages).toHaveLength(0);
  });

  it("ignores when path does not include teamName", () => {
    vi.mocked(safeReadJSON).mockReturnValue([{ from: "sprint-manager", content: "hi" }]);
    handleInboxMessage("/home/user/.claude/teams/other-team/inboxes/sprint-engineer-1.json");
    expect(state.messages).toHaveLength(0);
  });

  it("ignores null file contents", () => {
    vi.mocked(safeReadJSON).mockReturnValue(null);
    handleInboxMessage(inboxPath);
    expect(state.messages).toHaveLength(0);
  });

  it("parses a single message object (not array)", () => {
    vi.mocked(safeReadJSON).mockReturnValue({ from: "sprint-manager", content: "hello" });
    handleInboxMessage(inboxPath);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].from).toBe("sprint-manager");
    expect(state.messages[0].to).toBe("sprint-engineer-1");
  });

  it("parses multiple messages from array", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "msg one" },
      { from: "sprint-manager", content: "msg two" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.messages).toHaveLength(2);
  });

  it("respects inbox cursor — only processes new messages", () => {
    inboxCursors.set(inboxPath, 1);
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "old" },
      { from: "sprint-manager", content: "new" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("new");
  });

  it("updates cursor to message array length after processing", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "a" },
      { from: "sprint-manager", content: "b" },
    ]);
    handleInboxMessage(inboxPath);
    expect(inboxCursors.get(inboxPath)).toBe(2);
  });

  it("sets agent to idle on idle notification", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", type: "idle_notification", idleReason: "done" },
    ]);
    handleInboxMessage(inboxPath);
    const eng = state.agents.find((a) => a.name === "sprint-engineer-1");
    expect(eng?.status).toBe("idle");
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_status" }));
    // idle messages are not added to state.messages
    expect(state.messages).toHaveLength(0);
  });

  it("sets sender agent to active when previously idle", () => {
    const mgr = state.agents.find((a) => a.name === "sprint-manager")!;
    mgr.status = "idle";
    vi.mocked(safeReadJSON).mockReturnValue([{ from: "sprint-manager", content: "working" }]);
    handleInboxMessage(inboxPath);
    expect(mgr.status).toBe("active");
  });

  it("accumulates token usage from message usage field", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "hi", usage: { input_tokens: 100, output_tokens: 50 } },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.tokenUsage.total).toBe(150);
    expect(state.tokenUsage.byAgent["sprint-engineer-1"]).toBe(150);
    expect(state.tokenUsage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("TASK_ASSIGNED — sets task to in_progress and assigns owner", () => {
    state.tasks = [{ id: "1", subject: "Do it", status: "pending", owner: "", blockedBy: [] }];
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "TASK_ASSIGNED: #1 — Do it" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.tasks[0].status).toBe("in_progress");
    expect(state.tasks[0].owner).toBe("sprint-engineer-1");
    expect(taskProtocolOverrides.get("1")?.status).toBe("in_progress");
  });

  it("READY_FOR_REVIEW — triggers checkpoint when task id is in checkpoints", () => {
    state.tasks = [{ id: "2", subject: "Gated task", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] }];
    state.checkpoints = ["2"];
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-engineer-1", content: "READY_FOR_REVIEW: #2 — done" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.pendingCheckpoint).toMatchObject({ taskId: "2", taskSubject: "Gated task" });
    expect(state.checkpoints).not.toContain("2");
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "checkpoint" }));
  });

  it("READY_FOR_REVIEW — adds task to reviewTaskIds", () => {
    state.tasks = [{ id: "3", subject: "Review me", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] }];
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-engineer-1", content: "READY_FOR_REVIEW: #3 — done" },
    ]);
    handleInboxMessage("/home/user/.claude/teams/sprint-abc/inboxes/sprint-manager.json");
    expect(state.reviewTaskIds).toContain("3");
  });

  it("APPROVED — sets task to completed and removes from reviewTaskIds", () => {
    state.tasks = [{ id: "4", subject: "Approve me", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] }];
    state.reviewTaskIds = ["4"];
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "APPROVED: #4" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.tasks[0].status).toBe("completed");
    expect(state.reviewTaskIds).not.toContain("4");
  });

  it("REQUEST_CHANGES — keeps task in_progress and removes from reviewTaskIds", () => {
    state.tasks = [{ id: "5", subject: "Fix me", status: "in_progress", owner: "sprint-engineer-1", blockedBy: [] }];
    state.reviewTaskIds = ["5"];
    // taskMatch regex requires a digit right after the colon: REQUEST_CHANGES: #N or N
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-manager", content: "REQUEST_CHANGES: #5 — fix the tests" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.tasks[0].status).toBe("in_progress");
    expect(state.reviewTaskIds).not.toContain("5");
  });

  it("ESCALATE — sets escalation on state", () => {
    vi.mocked(safeReadJSON).mockReturnValue([
      { from: "sprint-engineer-1", content: "ESCALATE: 6 — blocked on API" },
    ]);
    handleInboxMessage(inboxPath);
    expect(state.escalation).toMatchObject({
      taskId: "6",
      from: "sprint-engineer-1",
    });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "escalation" }));
  });

  describe("autonomous mode phase transitions", () => {
    beforeEach(() => {
      state.mode = "autonomous";
    });

    it("NEXT_CYCLE — increments cycle and sets phase to analyzing", () => {
      state.cycle = 1;
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "NEXT_CYCLE: 2" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.cycle).toBe(2);
      expect(state.phase).toBe("analyzing");
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "cycle_info" }));
    });

    it("NEXT_CYCLE without number — increments cycle by 1", () => {
      state.cycle = 3;
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "NEXT_CYCLE: starting next" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.cycle).toBe(4);
    });

    it("ROADMAP_READY — sets phase to sprinting and extracts cycle number", () => {
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "ROADMAP_READY: cycle 3" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.phase).toBe("sprinting");
      expect(state.cycle).toBe(3);
    });

    it("CYCLE_COMPLETE — sets phase to validating", () => {
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "CYCLE_COMPLETE: done" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.phase).toBe("validating");
    });

    it("SPRINT_COMPLETE — sets phase to validating", () => {
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "SPRINT_COMPLETE: all done" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.phase).toBe("validating");
    });

    it("ACCEPTANCE — sets phase to analyzing", () => {
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "ACCEPTANCE: passed" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.phase).toBe("analyzing");
    });

    it("phase transition broadcasts cycle_info and a system message", () => {
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "ROADMAP_READY: cycle 1" },
      ]);
      handleInboxMessage(inboxPath);
      const events = vi.mocked(broadcast).mock.calls.map((c) => c[0].type);
      expect(events).toContain("cycle_info");
      expect(events).toContain("message_sent");
    });

    it("does not trigger phase change in manual mode", () => {
      state.mode = "manual";
      state.phase = "idle";
      vi.mocked(safeReadJSON).mockReturnValue([
        { from: "sprint-manager", content: "ROADMAP_READY: cycle 1" },
      ]);
      handleInboxMessage(inboxPath);
      expect(state.phase).toBe("idle");
    });
  });
});
