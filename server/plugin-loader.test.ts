import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { SprintState, TaskInfo } from "./state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `tc-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
  checkpoints: [],
  pendingCheckpoint: null,
  tmuxAvailable: false,
  tmuxSessionName: null,
};

const baseTask: TaskInfo = {
  id: "1",
  subject: "Fix bug",
  status: "completed",
  owner: "sprint-engineer-1",
  blockedBy: [],
};

// ─── loadPluginPaths ──────────────────────────────────────────────────────────

describe("loadPluginPaths", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns empty array when no .sprint.yml", async () => {
    const { loadPluginPaths } = await import("./plugin-loader.js");
    expect(loadPluginPaths(dir)).toEqual([]);
  });

  it("returns empty array when no plugins section", async () => {
    const { loadPluginPaths } = await import("./plugin-loader.js");
    writeSprintYml(dir, "agents:\n  model: sonnet\n");
    expect(loadPluginPaths(dir)).toEqual([]);
  });

  it("parses plugin paths from yml list", async () => {
    const { loadPluginPaths } = await import("./plugin-loader.js");
    writeSprintYml(dir, [
      "plugins:",
      "  - ./my-plugin.js",
      "  - teamclaude-slack-plugin",
    ].join("\n") + "\n");
    expect(loadPluginPaths(dir)).toEqual(["./my-plugin.js", "teamclaude-slack-plugin"]);
  });

  it("strips surrounding quotes from paths", async () => {
    const { loadPluginPaths } = await import("./plugin-loader.js");
    writeSprintYml(dir, [
      "plugins:",
      '  - "./my-plugin.js"',
      "  - 'another-plugin'",
    ].join("\n") + "\n");
    expect(loadPluginPaths(dir)).toEqual(["./my-plugin.js", "another-plugin"]);
  });

  it("ignores empty lines", async () => {
    const { loadPluginPaths } = await import("./plugin-loader.js");
    writeSprintYml(dir, "plugins:\n  - ./plugin-a.js\n\nagents:\n  model: haiku\n");
    const paths = loadPluginPaths(dir);
    expect(paths).toEqual(["./plugin-a.js"]);
  });
});

// ─── loadPlugins ──────────────────────────────────────────────────────────────

describe("loadPlugins", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("loads no plugins when nothing configured", async () => {
    const mod = await import("./plugin-loader.js");
    await mod.loadPlugins(dir);
    expect(mod.getPlugins()).toHaveLength(0);
  });

  it("loads a valid plugin from .teamclaude/plugins/", async () => {
    const pluginsDir = join(dir, ".teamclaude", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, `plugin-${Date.now()}.js`);
    writeFileSync(pluginPath, `export default { name: "my-plugin", hooks: {} };`, "utf-8");

    const mod = await import("./plugin-loader.js");
    await mod.loadPlugins(dir);
    const plugins = mod.getPlugins();
    expect(plugins.some((p) => p.name === "my-plugin")).toBe(true);
  });

  it("skips plugins without a name property", async () => {
    const pluginsDir = join(dir, ".teamclaude", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, `bad-plugin-${Date.now()}.js`);
    writeFileSync(pluginPath, `export default { hooks: {} };`, "utf-8");

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./plugin-loader.js");
    await mod.loadPlugins(dir);
    // No plugin with undefined name should be added
    const plugins = mod.getPlugins();
    expect(plugins.every((p) => typeof p.name === "string")).toBe(true);
    consoleSpy.mockRestore();
  });

  it("does not crash when a plugin file fails to import", async () => {
    const pluginsDir = join(dir, ".teamclaude", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const pluginPath = join(pluginsDir, `broken-${Date.now()}.js`);
    writeFileSync(pluginPath, `throw new Error("intentional load error");`, "utf-8");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./plugin-loader.js");
    await expect(mod.loadPlugins(dir)).resolves.not.toThrow();
    consoleSpy.mockRestore();
  });
});

// ─── Hook dispatchers ─────────────────────────────────────────────────────────
// These tests inject plugins directly via loadPlugins with inline-exported modules.
// We create real .js plugin files that use a shared global spy channel.

describe("fireOnSprintStart", () => {
  afterEach(async () => { const mod = await import("./plugin-loader.js"); (mod.getPlugins() as any[]).length = 0; });

  it("calls onSprintStart hook on registered plugins", async () => {
    const mod = await import("./plugin-loader.js");
    const onSprintStart = vi.fn();
    // Inject plugin directly into the registry
    const plugin = { name: "test-start", hooks: { onSprintStart } };
    // Access internal registry via getPlugins — we need to push directly
    // Use a fresh load with a synthetic plugin by calling the exported API
    // The cleanest way: reset by calling loadPlugins on empty dir, then manually test hook
    const emptyDir = makeTmpDir();
    try {
      await mod.loadPlugins(emptyDir);
      // getPlugins() returns readonly array; push via casting for test purposes
      (mod.getPlugins() as any[]).push(plugin);
      mod.fireOnSprintStart(baseState);
      await new Promise((r) => setTimeout(r, 0));
      expect(onSprintStart).toHaveBeenCalledWith(baseState);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("fireOnTaskComplete", () => {
  afterEach(async () => { const mod = await import("./plugin-loader.js"); (mod.getPlugins() as any[]).length = 0; });

  it("calls onTaskComplete hook with task and state", async () => {
    const mod = await import("./plugin-loader.js");
    const onTaskComplete = vi.fn();
    const emptyDir = makeTmpDir();
    try {
      await mod.loadPlugins(emptyDir);
      (mod.getPlugins() as any[]).push({ name: "test-complete", hooks: { onTaskComplete } });
      mod.fireOnTaskComplete(baseTask, baseState);
      await new Promise((r) => setTimeout(r, 0));
      expect(onTaskComplete).toHaveBeenCalledWith(baseTask, baseState);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("fireOnEscalation", () => {
  afterEach(async () => { const mod = await import("./plugin-loader.js"); (mod.getPlugins() as any[]).length = 0; });

  it("calls onEscalation hook with escalation and state", async () => {
    const mod = await import("./plugin-loader.js");
    const onEscalation = vi.fn();
    const emptyDir = makeTmpDir();
    const escalation = { taskId: "3", reason: "Stuck", from: "engineer-1", timestamp: Date.now() };
    const stateWithEscalation = { ...baseState, escalation };
    try {
      await mod.loadPlugins(emptyDir);
      (mod.getPlugins() as any[]).push({ name: "test-escalation", hooks: { onEscalation } });
      mod.fireOnEscalation(escalation, stateWithEscalation);
      await new Promise((r) => setTimeout(r, 0));
      expect(onEscalation).toHaveBeenCalledWith(escalation, stateWithEscalation);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("fireOnSprintStop", () => {
  afterEach(async () => { const mod = await import("./plugin-loader.js"); (mod.getPlugins() as any[]).length = 0; });

  it("calls onSprintStop hook with state", async () => {
    const mod = await import("./plugin-loader.js");
    const onSprintStop = vi.fn();
    const emptyDir = makeTmpDir();
    try {
      await mod.loadPlugins(emptyDir);
      (mod.getPlugins() as any[]).push({ name: "test-stop", hooks: { onSprintStop } });
      mod.fireOnSprintStop(baseState);
      await new Promise((r) => setTimeout(r, 0));
      expect(onSprintStop).toHaveBeenCalledWith(baseState);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("plugin hook error isolation", () => {
  afterEach(async () => { const mod = await import("./plugin-loader.js"); (mod.getPlugins() as any[]).length = 0; });

  it("a throwing hook does not prevent subsequent hooks from running", async () => {
    const mod = await import("./plugin-loader.js");
    const secondHook = vi.fn();
    const emptyDir = makeTmpDir();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mod.loadPlugins(emptyDir);
      const plugins = mod.getPlugins() as any[];
      plugins.push({ name: "throwing-plugin", hooks: { onSprintStart: () => { throw new Error("boom"); } } });
      plugins.push({ name: "second-plugin", hooks: { onSprintStart: secondHook } });
      mod.fireOnSprintStart(baseState);
      await new Promise((r) => setTimeout(r, 0));
      expect(secondHook).toHaveBeenCalled();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      consoleSpy.mockRestore();
    }
  });

  it("a plugin with no hooks for the fired event is silently skipped", async () => {
    const mod = await import("./plugin-loader.js");
    const emptyDir = makeTmpDir();
    try {
      await mod.loadPlugins(emptyDir);
      (mod.getPlugins() as any[]).push({ name: "no-hooks-plugin" });
      expect(() => mod.fireOnSprintStart(baseState)).not.toThrow();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
