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

    it("includes both engineer names in the prompt", () => {
      const prompt = compileSprintPrompt("Build features", 2, false, 1);
      expect(prompt).toContain("sprint-engineer-1");
      expect(prompt).toContain("sprint-engineer-2");
    });
  });

  describe("autonomous mode — 2 engineers", () => {
    it("includes parallel instruction", () => {
      const prompt = compileSprintPrompt("Build features", 2, true, 1);
      expect(prompt).toContain("parallel");
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
});
