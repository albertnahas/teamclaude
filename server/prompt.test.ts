import { describe, it, expect } from "vitest";
import { compileSprintPrompt } from "./prompt";
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
