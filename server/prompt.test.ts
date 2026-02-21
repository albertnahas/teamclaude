import { describe, it, expect } from "vitest";
import { compileSprintPrompt } from "./prompt";

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

    it("includes quality review instructions for manager", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("dead code");
      expect(prompt).toContain("duplicate");
      expect(prompt).toContain("REQUEST_CHANGES");
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
    it("tells engineers to run tests before submitting", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).toContain("Run the project");
      expect(prompt).toContain("test");
    });

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

  describe("learnings injection", () => {
    it("includes learnings section when provided", () => {
      const learnings = "## Sprint sprint-123\nCompleted: 3/5 tasks";
      const prompt = compileSprintPrompt("Build it", 1, false, 1, learnings);
      expect(prompt).toContain("## Past Sprint Learnings");
      expect(prompt).toContain("Completed: 3/5 tasks");
    });

    it("omits learnings section when empty string", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1, "");
      expect(prompt).not.toContain("Past Sprint Learnings");
    });

    it("omits learnings section when undefined", () => {
      const prompt = compileSprintPrompt("Build it", 1, false, 1);
      expect(prompt).not.toContain("Past Sprint Learnings");
    });

    it("injects learnings into PM prompt in autonomous mode", () => {
      const learnings = "## Sprint sprint-456\nAvoid auth patterns";
      const prompt = compileSprintPrompt("Plan it", 1, true, 1, learnings);
      expect(prompt).toContain("Past sprint learnings");
      expect(prompt).toContain("Avoid auth patterns");
    });
  });
});
