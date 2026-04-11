// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { WsEvent, AgentInfo, TaskInfo, Message } from "./types";

// Mock useWebSocket so we control event delivery without a real WebSocket
let capturedHandler: ((event: WsEvent) => void) | null = null;
vi.mock("./hooks/useWebSocket", () => ({
  useWebSocket: (handler: (event: WsEvent) => void) => {
    capturedHandler = handler;
  },
}));

vi.mock("./hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

// Stub fetch — SetupPhase and other components may call it
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
  capturedHandler = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Helper: send an init event that puts App into sprint phase
function sendSprintInit(overrides: Partial<Parameters<typeof buildInitState>[0]> = {}) {
  act(() => {
    capturedHandler?.({
      type: "init",
      state: buildInitState(overrides),
    });
  });
}

function buildInitState(overrides: {
  agents?: AgentInfo[];
  tasks?: TaskInfo[];
  messages?: Message[];
} = {}) {
  return {
    teamName: "test-team",
    projectName: "test-project",
    agents: [],
    tasks: [],
    messages: [],
    paused: false,
    escalation: null,
    mergeConflict: null,
    mode: "autonomous" as const,
    cycle: 1,
    phase: "sprinting" as const,
    reviewTaskIds: [],
    preValidatingTaskIds: [],
    validatingTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    tmuxAvailable: false,
    tmuxSessionName: null,
    ...overrides,
  };
}

import App from "./App";

describe("isLaunching overlay", () => {
  it("shows launching overlay when sprint is active but no agents, tasks, or messages", () => {
    render(<App />);
    sendSprintInit();

    expect(screen.getByText("Initializing sprint...")).toBeDefined();
    expect(screen.getByText("Waiting for agents to come online")).toBeDefined();
    expect(document.querySelector(".launching-overlay")).not.toBeNull();
  });

  it("hides launching overlay once agents appear", () => {
    render(<App />);
    sendSprintInit({ agents: [{ name: "sprint-engineer", agentId: "a1", agentType: "sprint-engineer", status: "active" }] });

    expect(document.querySelector(".launching-overlay")).toBeNull();
    expect(screen.queryByText("Initializing sprint...")).toBeNull();
  });

  it("hides launching overlay once tasks appear", () => {
    render(<App />);
    sendSprintInit({ tasks: [{ id: "1", subject: "Do something", status: "pending", owner: "", blockedBy: [] }] });

    expect(document.querySelector(".launching-overlay")).toBeNull();
    expect(screen.queryByText("Initializing sprint...")).toBeNull();
  });

  it("hides launching overlay once messages appear", () => {
    render(<App />);
    sendSprintInit({ messages: [{ id: "m1", from: "sprint-manager", to: "sprint-engineer", content: "Go!", timestamp: Date.now() }] });

    expect(document.querySelector(".launching-overlay")).toBeNull();
    expect(screen.queryByText("Initializing sprint...")).toBeNull();
  });

  it("container is hidden (visibility:hidden) while overlay is shown", () => {
    render(<App />);
    sendSprintInit();

    const container = document.querySelector<HTMLElement>(".container");
    expect(container?.style.visibility).toBe("hidden");
  });

  it("container is visible once overlay is dismissed", () => {
    render(<App />);
    sendSprintInit({ agents: [{ name: "sprint-engineer", agentId: "a1", agentType: "sprint-engineer", status: "active" }] });

    const container = document.querySelector<HTMLElement>(".container");
    expect(container?.style.visibility).toBe("visible");
  });
});
