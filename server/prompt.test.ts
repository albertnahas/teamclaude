import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { compileSprintPrompt, loadCustomRoles, loadAgentDefinition } from "./prompt";
import type { RoleLearnings } from "./learnings";

describe("compileSprintPrompt", () => {
  describe("manual mode — 1 engineer", () => {
    it("includes manager prompt, engineer prompt, and roadmap section", () => {
      const prompt = compileSprintPrompt("Build auth module", 1, false, 1);
      expect(prompt).toContain("MANUAL mode");
      expect(prompt).toContain("sprint-manager");
      expect(prompt).toContain("sprint-engineer");
      expect(prompt).toContain("## Roadmap");
      expect(prompt).toContain("Build auth module");
    });

    it("uses single engineer name sprint-engineer (not numbered)", () => {
      const prompt = compileSprintPrompt("Do something", 1, false, 1);
      expect(prompt).toContain('"sprint-engineer"');
      expect(prompt).not.toContain("sprint-engineer-1");
    });
  });

  describe("manual mode — 2 engineers", () => {
    it("includes both engineer prompts", () => {
      const prompt = compileSprintPrompt("Build features", 2, false, 1);
      expect(prompt).toContain("sprint-engineer-1");
      expect(prompt).toContain("sprint-engineer-2");
    });
  });

  describe("autonomous mode — 2 engineers", () => {
    it("includes round-robin distribution rule", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("round-robin");
      expect(prompt).toContain("Distribute tasks evenly");
    });

    it("includes quality review checklist for manager", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("Review checklist");
      expect(prompt).toContain("REQUEST_CHANGES");
    });

    it("manager checklist includes CSS verification", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("CSS exists for every new className");
      expect(prompt).toContain("Grep the stylesheet");
    });

    it("manager checklist includes duplicate data detection", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("Single source of truth");
      expect(prompt).toContain("no duplicate pricing tables");
    });

    it("manager checklist includes test isolation verification", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("mocks cover all imported modules");
      expect(prompt).toContain("afterEach cleanup");
    });

    it("manager checklist requires reading actual files", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("Read the actual files changed");
      expect(prompt).toContain("do not approve based solely on test pass/fail");
    });

    it("manager checklist includes data correctness verification", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("verify they are factually correct");
      expect(prompt).toContain("Do not trust AI-generated numbers");
    });
  });

  describe("autonomous mode (includePM=true)", () => {
    it("includes PM, manager, and engineer prompts", () => {
      const prompt = compileSprintPrompt("Build product", 1, true, 1);
      expect(prompt).toContain("AUTONOMOUS mode");
      expect(prompt).toContain("sprint-pm");
      expect(prompt).toContain("sprint-manager");
      expect(prompt).toContain("sprint-engineer");
    });

    it("includes roadmap content in PM prompt when provided", () => {
      const prompt = compileSprintPrompt("Ship MVP features", 1, true, 1);
      expect(prompt).toContain("Ship MVP features");
    });

    it("omits roadmap section from PM prompt when roadmap is empty", () => {
      const prompt = compileSprintPrompt("", 1, true, 1);
      expect(prompt).not.toContain("User guidance:");
    });

    it("PM prompt requires acceptance criteria in task descriptions", () => {
      const prompt = compileSprintPrompt("Build it", 1, true, 1);
      expect(prompt).toContain("acceptance criteria");
    });
  });

  describe("engineer quality instructions", () => {
    it("tells engineers NOT to mark tasks as completed", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("Do NOT call TaskUpdate to set status");
    });

    it("tells engineers to search for existing patterns", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("search the codebase");
      expect(prompt).toContain("Do NOT create duplicates");
    });

    it("tells engineers to clean up dead code", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("dead code");
    });

    it("includes pre-submit checklist with CSS verification", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("Pre-submit checklist");
      expect(prompt).toContain("CSS exists for every className");
    });

    it("includes pre-submit checklist with mock isolation requirement", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("every external dependency is mocked");
      expect(prompt).toContain("afterEach cleanup");
    });

    it("includes pre-submit checklist with React hook guidance", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("useRef or useMemo");
      expect(prompt).toContain("Never pass inline object literals as useEffect dependencies");
    });

    it("includes pre-submit checklist with race condition guidance", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("capture values in local variables");
    });

    it("includes pre-submit checklist requiring duplicate search for constants", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("Never duplicate data that exists elsewhere");
    });
  });

  describe("autonomous mode — autoEngineers (engineers=0)", () => {
    it("tells manager to determine engineer count, not hardcoded names", () => {
      const prompt = compileSprintPrompt("Analyze and build", 0, true, 1);
      expect(prompt).toContain("manager determines");
      expect(prompt).toContain("sprint-engineer-N");
      expect(prompt).not.toContain('"sprint-engineer-1"');
    });
  });

  describe("cycles > 1", () => {
    it("includes CYCLE_COMPLETE section when cycles > 1", () => {
      const prompt = compileSprintPrompt("Multi-cycle project", 1, true, 3);
      expect(prompt).toContain("CYCLE_COMPLETE");
      expect(prompt).toContain("3 total");
    });

    it("omits cycle section when cycles = 1", () => {
      const prompt = compileSprintPrompt("Single cycle", 1, true, 1);
      expect(prompt).not.toContain("CYCLE_COMPLETE");
    });
  });

  describe("team name", () => {
    it("uses a generated team name prefixed with sprint-", () => {
      const prompt = compileSprintPrompt("Any roadmap", 1, false, 1);
      expect(prompt).toMatch(/sprint-\d+/);
    });
  });

  describe("role-based learnings injection", () => {
    const learnings: RoleLearnings = {
      orchestrator: "- [\u00d73] Break tasks into smaller units",
      pm: "- [\u00d72] Include acceptance criteria with verification commands",
      manager: "- [\u00d72] Provide ALL feedback at once in REQUEST_CHANGES",
      engineer: "- [\u00d71] Run tests before READY_FOR_REVIEW",
    };

    it("injects orchestrator learnings in main prompt section", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1, learnings);
      expect(prompt).toContain("## Process Learnings");
      expect(prompt).toContain("Break tasks into smaller units");
    });

    it("injects PM learnings into PM prompt (autonomous)", () => {
      const prompt = compileSprintPrompt("Build it", 1, true, 1, learnings);
      expect(prompt).toContain("apply these improvements to task planning");
      expect(prompt).toContain("Include acceptance criteria");
    });

    it("injects manager learnings into manager prompt", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1, learnings);
      expect(prompt).toContain("apply these improvements to review and coordination");
      expect(prompt).toContain("Provide ALL feedback at once");
    });

    it("injects engineer learnings into engineer prompt", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1, learnings);
      expect(prompt).toContain("apply these improvements to implementation");
      expect(prompt).toContain("Run tests before READY_FOR_REVIEW");
    });

    it("includes reflection instruction in manager prompt", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("PROCESS_LEARNING:");
      expect(prompt).toContain("reflect on the sprint process");
    });

    it("omits learnings sections when undefined", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).not.toContain("Process Learnings");
      expect(prompt).not.toContain("apply these improvements to task planning");
    });

    it("omits learnings sections when all empty strings", () => {
      const empty: RoleLearnings = { orchestrator: "", pm: "", manager: "", engineer: "" };
      const prompt = compileSprintPrompt("Build it", 1, false, 1, empty);
      expect(prompt).not.toContain("## Process Learnings");
      expect(prompt).not.toContain("apply these improvements");
    });

    it("includes only non-empty role sections", () => {
      const partial: RoleLearnings = {
        orchestrator: "",
        pm: "- [\u00d71] Be specific",
        manager: "",
        engineer: "",
      };
      const prompt = compileSprintPrompt("Build it", 1, true, 1, partial);
      expect(prompt).not.toContain("## Process Learnings"); // orchestrator empty
      expect(prompt).toContain("apply these improvements to task planning");
      expect(prompt).not.toContain("apply these improvements to review");
      expect(prompt).not.toContain("apply these improvements to implementation");
    });
  });
});

// ─── loadCustomRoles ──────────────────────────────────────────────────────────

describe("loadCustomRoles", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `tc-roles-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no .sprint.yml", () => {
    expect(loadCustomRoles(dir)).toBeNull();
  });

  it("returns null when no agents section", () => {
    writeFileSync(join(dir, ".sprint.yml"), "server:\n  port: 3456\n");
    expect(loadCustomRoles(dir)).toBeNull();
  });

  it("returns null when agents section has no roles", () => {
    writeFileSync(join(dir, ".sprint.yml"), "agents:\n  model: sonnet\n");
    expect(loadCustomRoles(dir)).toBeNull();
  });

  it("parses a roles list", () => {
    writeFileSync(join(dir, ".sprint.yml"), [
      "agents:",
      "  model: sonnet",
      "  roles:",
      "    - engineer",
      "    - engineer",
      "    - qa",
    ].join("\n") + "\n");
    expect(loadCustomRoles(dir)).toEqual(["engineer", "engineer", "qa"]);
  });

  it("strips quotes from role names", () => {
    writeFileSync(join(dir, ".sprint.yml"), [
      "agents:",
      "  roles:",
      '    - "engineer"',
      "    - 'qa'",
    ].join("\n") + "\n");
    expect(loadCustomRoles(dir)).toEqual(["engineer", "qa"]);
  });

  it("returns null for empty roles list", () => {
    writeFileSync(join(dir, ".sprint.yml"), "agents:\n  roles:\n");
    expect(loadCustomRoles(dir)).toBeNull();
  });
});

// ─── loadAgentDefinition ──────────────────────────────────────────────────────

describe("loadAgentDefinition", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `tc-agentdef-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "agents"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when agent file does not exist", () => {
    expect(loadAgentDefinition("nonexistent", dir)).toBeNull();
  });

  it("loads agent definition and strips YAML frontmatter", () => {
    writeFileSync(join(dir, "agents", "qa.md"), [
      "---",
      "name: sprint-qa",
      "model: sonnet",
      "---",
      "",
      "# QA Engineer",
      "",
      "You are a QA agent.",
    ].join("\n"));
    const def = loadAgentDefinition("qa", dir);
    expect(def).not.toBeNull();
    expect(def).toContain("QA Engineer");
    expect(def).not.toContain("---");
    expect(def).not.toContain("name: sprint-qa");
  });

  it("normalizes sprint- prefix (qa and sprint-qa both load qa.md)", () => {
    writeFileSync(join(dir, "agents", "qa.md"), "---\nname: qa\n---\n# QA");
    expect(loadAgentDefinition("qa", dir)).toContain("QA");
    expect(loadAgentDefinition("sprint-qa", dir)).toContain("QA");
  });

  it("returns content for tech-writer role", () => {
    writeFileSync(join(dir, "agents", "tech-writer.md"), "---\nname: tech-writer\n---\n# Tech Writer");
    expect(loadAgentDefinition("tech-writer", dir)).toContain("Tech Writer");
  });
});

// ─── compileSprintPrompt with custom roles ────────────────────────────────────

describe("compileSprintPrompt — custom roles", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `tc-prompt-roles-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "agents"), { recursive: true });
    // Write a minimal QA agent definition
    writeFileSync(join(dir, "agents", "qa.md"), [
      "---",
      "name: sprint-qa",
      "---",
      "# QA",
      "You are a QA agent for team.",
    ].join("\n"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes custom role agent in manual mode prompt", () => {
    const prompt = compileSprintPrompt("Build it", 1, false, 1, undefined, ["engineer", "qa"], dir);
    expect(prompt).toContain("sprint-engineer");
    expect(prompt).toContain("sprint-qa");
  });

  it("uses agent definition file content for known custom roles", () => {
    const prompt = compileSprintPrompt("Build it", 1, false, 1, undefined, ["qa"], dir);
    expect(prompt).toContain("QA");
    expect(prompt).toContain("QA agent for team");
  });

  it("numbers multiple instances of the same role", () => {
    const prompt = compileSprintPrompt("Build it", 2, false, 1, undefined, ["engineer", "engineer"], dir);
    expect(prompt).toContain("sprint-engineer-1");
    expect(prompt).toContain("sprint-engineer-2");
  });

  it("uses plain name when only one instance of a role", () => {
    const prompt = compileSprintPrompt("Build it", 1, false, 1, undefined, ["qa"], dir);
    expect(prompt).toContain("sprint-qa");
    expect(prompt).not.toContain("sprint-qa-1");
  });

  it("includes distribution rule for multiple custom agents", () => {
    const prompt = compileSprintPrompt("Build it", 2, false, 1, undefined, ["engineer", "qa"], dir);
    expect(prompt).toContain("round-robin");
  });

  it("falls back to generic prompt for unknown roles", () => {
    // No agents/designer.md exists in tmp dir
    const prompt = compileSprintPrompt("Build it", 1, false, 1, undefined, ["designer"], dir);
    expect(prompt).toContain("sprint-designer");
    expect(prompt).toContain("specialized skills");
  });

  it("works in autonomous mode with custom roles", () => {
    const prompt = compileSprintPrompt("Build it", 1, true, 1, undefined, ["engineer", "qa"], dir);
    expect(prompt).toContain("AUTONOMOUS mode");
    expect(prompt).toContain("sprint-qa");
  });
});
