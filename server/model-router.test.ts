import { describe, it, expect, vi } from "vitest";
import { routeTaskToModel, MODEL_FOR_TIER, loadModelOverrides } from "./model-router.js";
import type { TaskInfo } from "./state.js";

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "1",
    subject: "Do something",
    status: "pending",
    owner: "engineer",
    blockedBy: [],
    ...overrides,
  };
}

describe("MODEL_FOR_TIER", () => {
  it("maps each tier to the correct model ID", () => {
    expect(MODEL_FOR_TIER.simple).toBe("claude-haiku-4-5-20251001");
    expect(MODEL_FOR_TIER.medium).toBe("claude-sonnet-4-6");
    expect(MODEL_FOR_TIER.complex).toBe("claude-opus-4-6");
  });
});

describe("routeTaskToModel — tier routing", () => {
  it("routes a simple task to haiku", () => {
    const task = makeTask({ subject: "Fix typo in README" });
    const decision = routeTaskToModel(task);
    expect(decision.tier).toBe("simple");
    expect(decision.model).toBe("claude-haiku-4-5-20251001");
  });

  it("routes a medium task to sonnet", () => {
    const task = makeTask({
      subject: "Add pagination to task list",
      description:
        "Implement pagination controls in the task list component. Update the API endpoint to accept page and limit query params. Display current page and total pages in the UI.",
    });
    const decision = routeTaskToModel(task);
    expect(decision.tier).toBe("medium");
    expect(decision.model).toBe("claude-sonnet-4-6");
  });

  it("routes a complex task to opus", () => {
    const task = makeTask({
      subject: "Refactor authentication architecture",
      description:
        "Migrate the existing session-based authentication to JWT tokens. Refactor all protected routes, update middleware, redesign the token refresh pipeline, and integrate with the new distributed session store. Changes span across the entire codebase.",
      blockedBy: ["1", "2", "3"],
    });
    const decision = routeTaskToModel(task);
    expect(decision.tier).toBe("complex");
    expect(decision.model).toBe("claude-opus-4-6");
  });
});

describe("routeTaskToModel — overrides", () => {
  it("uses override model when task ID matches", () => {
    const task = makeTask({ id: "42", subject: "Fix typo in README" });
    const decision = routeTaskToModel(task, { "42": "claude-opus-4-6" });
    expect(decision.model).toBe("claude-opus-4-6");
  });

  it("still derives tier and score from complexity when overridden", () => {
    const task = makeTask({ id: "42", subject: "Fix typo in README" });
    const decision = routeTaskToModel(task, { "42": "claude-opus-4-6" });
    expect(decision.tier).toBe("simple");
    expect(decision.score).toBeGreaterThanOrEqual(1);
    expect(decision.score).toBeLessThanOrEqual(3);
  });

  it("includes 'manual override' in the reason when overridden", () => {
    const task = makeTask({ id: "42", subject: "Fix typo in README" });
    const decision = routeTaskToModel(task, { "42": "claude-opus-4-6" });
    expect(decision.reason).toContain("manual override");
  });

  it("ignores overrides map when task ID is not present", () => {
    const task = makeTask({ id: "99", subject: "Fix typo in README" });
    const decision = routeTaskToModel(task, { "42": "claude-opus-4-6" });
    expect(decision.model).toBe(MODEL_FOR_TIER[decision.tier]);
    expect(decision.reason).not.toContain("manual override");
  });

  it("works with no overrides argument (undefined)", () => {
    const task = makeTask({ subject: "Fix typo" });
    const decision = routeTaskToModel(task, undefined);
    expect(decision.model).toBe(MODEL_FOR_TIER[decision.tier]);
  });
});

describe("loadModelOverrides", () => {
  it("returns empty object when file does not exist", () => {
    expect(loadModelOverrides("/nonexistent/path.yml")).toEqual({});
  });

  it("returns empty object when no models section in YAML", () => {
    const tmp = "/tmp/test-no-models.yml";
    const { writeFileSync, unlinkSync } = require("node:fs");
    writeFileSync(tmp, "sprint:\n  max_review_rounds: 3\n");
    expect(loadModelOverrides(tmp)).toEqual({});
    unlinkSync(tmp);
  });

  it("parses valid model overrides", () => {
    const tmp = "/tmp/test-model-overrides.yml";
    const { writeFileSync, unlinkSync } = require("node:fs");
    writeFileSync(
      tmp,
      `models:
  overrides:
    "1": claude-opus-4-6
    "3": claude-haiku-4-5-20251001
`
    );
    const result = loadModelOverrides(tmp);
    expect(result).toEqual({
      "1": "claude-opus-4-6",
      "3": "claude-haiku-4-5-20251001",
    });
    unlinkSync(tmp);
  });

  it("parses unquoted task IDs", () => {
    const tmp = "/tmp/test-unquoted.yml";
    const { writeFileSync, unlinkSync } = require("node:fs");
    writeFileSync(
      tmp,
      `models:
  overrides:
    2: claude-sonnet-4-6
`
    );
    const result = loadModelOverrides(tmp);
    expect(result).toEqual({ "2": "claude-sonnet-4-6" });
    unlinkSync(tmp);
  });

  it("skips commented-out overrides", () => {
    const tmp = "/tmp/test-comments.yml";
    const { writeFileSync, unlinkSync } = require("node:fs");
    writeFileSync(
      tmp,
      `models:
  overrides:
    # "1": claude-opus-4-6
    "2": claude-sonnet-4-6
`
    );
    const result = loadModelOverrides(tmp);
    expect(result).toEqual({ "2": "claude-sonnet-4-6" });
    unlinkSync(tmp);
  });

  it("returns empty object when models section has no overrides", () => {
    const tmp = "/tmp/test-no-overrides.yml";
    const { writeFileSync, unlinkSync } = require("node:fs");
    writeFileSync(tmp, "models:\n  # just a comment\n");
    expect(loadModelOverrides(tmp)).toEqual({});
    unlinkSync(tmp);
  });
});

