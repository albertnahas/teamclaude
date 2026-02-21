import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadMemories,
  saveMemory,
  getMemoriesForRole,
  deleteMemory,
  searchMemories,
  formatMemoriesForPrompt,
} from "./memory.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `tc-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── loadMemories ─────────────────────────────────────────────────────────────

describe("loadMemories", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns empty array when no memories file exists", () => {
    expect(loadMemories(dir)).toEqual([]);
  });

  it("returns stored memories after saving", () => {
    saveMemory(dir, "engineer", "test_pattern", "use vitest");
    const memories = loadMemories(dir);
    expect(memories).toHaveLength(1);
    expect(memories[0].key).toBe("test_pattern");
    expect(memories[0].value).toBe("use vitest");
    expect(memories[0].role).toBe("engineer");
  });
});

// ─── saveMemory ───────────────────────────────────────────────────────────────

describe("saveMemory", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("creates a new memory with required fields", () => {
    const m = saveMemory(dir, "engineer", "import_convention", "use .js extensions");
    expect(m.id).toBeTruthy();
    expect(m.role).toBe("engineer");
    expect(m.key).toBe("import_convention");
    expect(m.value).toBe("use .js extensions");
    expect(m.createdAt).toBeGreaterThan(0);
    expect(m.accessCount).toBe(0);
    expect(m.lastAccessed).toBeNull();
    expect(m.sprintId).toBeNull();
  });

  it("stores sprintId when provided", () => {
    const m = saveMemory(dir, "manager", "review_style", "be specific", "sprint-123");
    expect(m.sprintId).toBe("sprint-123");
  });

  it("upserts: updates value for same role+key", () => {
    saveMemory(dir, "engineer", "test_runner", "jest");
    saveMemory(dir, "engineer", "test_runner", "vitest");
    const memories = loadMemories(dir);
    expect(memories).toHaveLength(1);
    expect(memories[0].value).toBe("vitest");
    // accessCount increments on read, not write — upsert alone leaves it at 0
    expect(memories[0].accessCount).toBe(0);
  });

  it("stores distinct entries for different role+key combos", () => {
    saveMemory(dir, "engineer", "pattern", "value A");
    saveMemory(dir, "manager", "pattern", "value B");
    expect(loadMemories(dir)).toHaveLength(2);
  });

  it("persists memories to disk (survives reload)", () => {
    saveMemory(dir, "pm", "codebase_style", "TypeScript strict mode");
    const reloaded = loadMemories(dir);
    expect(reloaded[0].value).toBe("TypeScript strict mode");
  });
});

// ─── getMemoriesForRole ───────────────────────────────────────────────────────

describe("getMemoriesForRole", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns only memories for the specified role", () => {
    saveMemory(dir, "engineer", "k1", "v1");
    saveMemory(dir, "manager", "k2", "v2");
    saveMemory(dir, "engineer", "k3", "v3");

    const eng = getMemoriesForRole(dir, "engineer");
    expect(eng).toHaveLength(2);
    expect(eng.every((m) => m.role === "engineer")).toBe(true);
  });

  it("returns empty array for unknown role", () => {
    saveMemory(dir, "engineer", "k", "v");
    expect(getMemoriesForRole(dir, "pm")).toHaveLength(0);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      saveMemory(dir, "engineer", `key_${i}`, `value_${i}`);
    }
    const limited = getMemoriesForRole(dir, "engineer", 3);
    expect(limited).toHaveLength(3);
  });
});

// ─── deleteMemory ─────────────────────────────────────────────────────────────

describe("deleteMemory", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("removes an existing memory and returns true", () => {
    const m = saveMemory(dir, "engineer", "k", "v");
    expect(deleteMemory(dir, m.id)).toBe(true);
    expect(loadMemories(dir)).toHaveLength(0);
  });

  it("returns false for a non-existent ID", () => {
    expect(deleteMemory(dir, "nonexistent-id")).toBe(false);
  });

  it("only removes the targeted memory", () => {
    saveMemory(dir, "engineer", "k1", "v1");
    const m2 = saveMemory(dir, "engineer", "k2", "v2");
    deleteMemory(dir, m2.id);
    const remaining = loadMemories(dir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].key).toBe("k1");
  });
});

// ─── searchMemories ───────────────────────────────────────────────────────────

describe("searchMemories", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns memories matching key substring", () => {
    saveMemory(dir, "engineer", "import_convention", "use .js extensions");
    saveMemory(dir, "engineer", "test_runner", "vitest");
    const results = searchMemories(dir, "import");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("import_convention");
  });

  it("returns memories matching value substring", () => {
    saveMemory(dir, "engineer", "k1", "use vitest for testing");
    saveMemory(dir, "engineer", "k2", "use ESM imports");
    const results = searchMemories(dir, "vitest");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("k1");
  });

  it("is case-insensitive", () => {
    saveMemory(dir, "engineer", "TestRunner", "Vitest");
    expect(searchMemories(dir, "vitest")).toHaveLength(1);
    expect(searchMemories(dir, "TESTRUNNER")).toHaveLength(1);
  });

  it("returns empty array when no match", () => {
    saveMemory(dir, "engineer", "k", "v");
    expect(searchMemories(dir, "zzz-no-match")).toHaveLength(0);
  });

  it("searches by role", () => {
    saveMemory(dir, "engineer", "k", "v");
    saveMemory(dir, "manager", "k2", "v2");
    const results = searchMemories(dir, "manager");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((m) => m.role === "manager")).toBe(true);
  });
});

// ─── formatMemoriesForPrompt ──────────────────────────────────────────────────

describe("formatMemoriesForPrompt", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns empty string when no memories for role", () => {
    expect(formatMemoriesForPrompt(dir, "engineer")).toBe("");
  });

  it("returns formatted section with memories", () => {
    saveMemory(dir, "engineer", "test_pattern", "use vitest");
    saveMemory(dir, "engineer", "import_style", "always use .js extensions");
    const result = formatMemoriesForPrompt(dir, "engineer");
    expect(result).toContain("## Persistent Memory");
    expect(result).toContain("test_pattern: use vitest");
    expect(result).toContain("import_style: always use .js extensions");
  });

  it("only includes memories for the requested role", () => {
    saveMemory(dir, "engineer", "eng_key", "eng_value");
    saveMemory(dir, "manager", "mgr_key", "mgr_value");
    const result = formatMemoriesForPrompt(dir, "engineer");
    expect(result).toContain("eng_key");
    expect(result).not.toContain("mgr_key");
  });
});
