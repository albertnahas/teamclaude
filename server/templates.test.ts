import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTemplates, getTemplate } from "./templates.js";

// --- Template module tests ---

describe("loadTemplates — discovery", () => {
  it("finds all 4 built-in template files", () => {
    const templates = loadTemplates();
    expect(templates.length).toBe(4);
  });

  it("returns template ids matching filenames", () => {
    const ids = loadTemplates().map((t) => t.id).sort();
    expect(ids).toEqual(["bug-bash", "feature", "refactor", "security-audit"]);
  });

  it("never throws", () => {
    expect(() => loadTemplates()).not.toThrow();
  });
});

describe("loadTemplates — parsing required fields", () => {
  it("every template has a non-empty name", () => {
    for (const t of loadTemplates()) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("every template has a non-empty description", () => {
    for (const t of loadTemplates()) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("every template has a non-empty roles array", () => {
    for (const t of loadTemplates()) {
      expect(Array.isArray(t.agents.roles)).toBe(true);
      expect(t.agents.roles.length).toBeGreaterThan(0);
    }
  });

  it("every template has a positive integer cycles value", () => {
    for (const t of loadTemplates()) {
      expect(Number.isInteger(t.cycles)).toBe(true);
      expect(t.cycles).toBeGreaterThan(0);
    }
  });

  it("every template has a non-empty roadmap string", () => {
    for (const t of loadTemplates()) {
      expect(typeof t.roadmap).toBe("string");
      expect(t.roadmap.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("loadTemplates — specific template content", () => {
  it("bug-bash has 2 engineers and 1 qa role", () => {
    const t = loadTemplates().find((x) => x.id === "bug-bash")!;
    const roles = t.agents.roles;
    expect(roles.filter((r) => r === "engineer").length).toBe(2);
    expect(roles).toContain("qa");
    expect(t.cycles).toBe(1);
  });

  it("feature template has 2 cycles", () => {
    const t = loadTemplates().find((x) => x.id === "feature")!;
    expect(t.cycles).toBe(2);
  });

  it("security-audit uses opus model", () => {
    const t = loadTemplates().find((x) => x.id === "security-audit")!;
    expect(t.agents.model).toBe("opus");
  });

  it("refactor has a single engineer role", () => {
    const t = loadTemplates().find((x) => x.id === "refactor")!;
    expect(t.agents.roles).toEqual(["engineer"]);
  });

  it("roadmaps contain markdown headings", () => {
    for (const t of loadTemplates()) {
      expect(t.roadmap).toMatch(/^##\s/m);
    }
  });
});

describe("getTemplate — retrieval", () => {
  it("returns the correct template by id", () => {
    const t = getTemplate("bug-bash");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Bug Bash");
    expect(t!.id).toBe("bug-bash");
  });

  it("returns undefined for a nonexistent template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});

// --- CLI --template flag tests ---
// Spawn the CLI as a child process to verify end-to-end behavior.

const CLI = join(import.meta.dirname!, "..", "bin", "teamclaude.js");
const tmpBase = join(tmpdir(), `tc-cli-test-${Date.now()}`);
mkdirSync(tmpBase, { recursive: true });

function runCli(args: string[], opts: { cwd?: string } = {}): {
  stdout: string;
  stderr: string;
  code: number;
} {
  const result = spawnSync("node", [CLI, ...args], {
    cwd: opts.cwd ?? tmpBase,
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

describe("CLI --template list", () => {
  it("exits 0 and lists all available templates", () => {
    const { stdout, code } = runCli(["init", "--template", "list"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/bug-bash/);
    expect(stdout).toMatch(/feature/);
    expect(stdout).toMatch(/refactor/);
    expect(stdout).toMatch(/security-audit/);
  });

  it("shows descriptions alongside template names", () => {
    const { stdout } = runCli(["init", "--template", "list"]);
    // At least one description keyword should appear
    expect(stdout).toMatch(/bug|refactor|security|spec/i);
  });
});

describe("CLI --template <name> (valid)", () => {
  it("exits 0 and prints roadmap for bug-bash", () => {
    const outDir = join(tmpBase, "valid-bug-bash");
    mkdirSync(outDir, { recursive: true });
    const { stdout, code } = runCli(["init", "--template", "bug-bash"], { cwd: outDir });
    expect(code).toBe(0);
    expect(stdout).toMatch(/Bug Bash/);
    expect(stdout).toMatch(/Roadmap/i);
  });

  it("creates .sprint.yml in cwd", () => {
    const outDir = join(tmpBase, "valid-refactor");
    mkdirSync(outDir, { recursive: true });
    runCli(["init", "--template", "refactor"], { cwd: outDir });
    expect(existsSync(join(outDir, ".sprint.yml"))).toBe(true);
  });

  it(".sprint.yml contains agent model from template", () => {
    const outDir = join(tmpBase, "valid-security-audit");
    mkdirSync(outDir, { recursive: true });
    runCli(["init", "--template", "security-audit"], { cwd: outDir });
    const content = readFileSync(join(outDir, ".sprint.yml"), "utf-8");
    expect(content).toMatch(/model:\s*opus/);
  });

  it("prints cycles count for feature template", () => {
    const outDir = join(tmpBase, "valid-feature");
    mkdirSync(outDir, { recursive: true });
    const { stdout } = runCli(["init", "--template", "feature"], { cwd: outDir });
    expect(stdout).toMatch(/Cycles:\s*2/);
  });

  it("prints agent roles in output", () => {
    const outDir = join(tmpBase, "valid-roles");
    mkdirSync(outDir, { recursive: true });
    const { stdout } = runCli(["init", "--template", "bug-bash"], { cwd: outDir });
    expect(stdout).toMatch(/engineer/i);
    expect(stdout).toMatch(/qa/i);
  });
});

describe("CLI --template <name> (invalid)", () => {
  it("exits 1 for unknown template name", () => {
    const { code } = runCli(["init", "--template", "nonexistent"]);
    expect(code).toBe(1);
  });

  it("prints available templates list in error output", () => {
    const { stderr } = runCli(["init", "--template", "nonexistent"]);
    expect(stderr).toMatch(/Available/i);
    expect(stderr).toMatch(/bug-bash/);
  });

  it("prints unknown template name in error message", () => {
    const { stderr } = runCli(["init", "--template", "nonexistent"]);
    expect(stderr).toMatch(/nonexistent/);
  });
});
