import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { state, resetState, detectProjectName } from "./state";

describe("resetState", () => {
  beforeEach(() => {
    // Dirty the state before each test
    state.teamName = "my-team";
    state.projectName = "my-project";
    state.agents = [{ name: "a", agentId: "1", agentType: "t", status: "active" }];
    state.tasks = [{ id: "1", subject: "s", status: "in_progress", owner: "a", blockedBy: [] }];
    state.messages = [{ id: "m1", timestamp: 1, from: "a", to: "b", content: "hi" }];
    state.mode = "autonomous";
    state.paused = true;
    state.escalation = { taskId: "1", reason: "r", from: "a", timestamp: 1 };
    state.cycle = 5;
    state.phase = "sprinting";
    state.reviewTaskIds = ["1", "2"];
  });

  it("resets all fields to initial values", () => {
    resetState();
    expect(state.teamName).toBeNull();
    expect(state.projectName).toBeNull();
    expect(state.agents).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.mode).toBe("manual");
    expect(state.paused).toBe(false);
    expect(state.escalation).toBeNull();
    expect(state.cycle).toBe(0);
    expect(state.phase).toBe("idle");
    expect(state.reviewTaskIds).toEqual([]);
  });
});

describe("detectProjectName", () => {
  it("reads the name field from package.json in the given directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "tc-test-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-pkg", version: "1.0.0" }));
    expect(detectProjectName(dir)).toBe("my-pkg");
  });

  it("falls back to the directory basename when no manifest is found", () => {
    const dir = mkdtempSync(join(tmpdir(), "tc-fallback-"));
    expect(detectProjectName(dir)).toBe(dir.split("/").pop());
  });
});
