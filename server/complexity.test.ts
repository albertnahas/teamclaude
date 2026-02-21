import { describe, it, expect } from "vitest";
import { scoreTaskComplexity } from "./complexity.js";
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

describe("scoreTaskComplexity — simple tier (1-3)", () => {
  it("returns simple for a typo fix", () => {
    const result = scoreTaskComplexity(
      makeTask({ subject: "Fix typo in README", description: "Small rename" })
    );
    expect(result.tier).toBe("simple");
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(3);
  });
});

describe("scoreTaskComplexity — medium tier (4-7)", () => {
  it("returns medium for a feature addition with moderate description", () => {
    const result = scoreTaskComplexity(
      makeTask({
        subject: "Add pagination to task list",
        description:
          "Implement pagination controls in the task list component. Update the API endpoint to accept page and limit query params. Display current page and total pages in the UI.",
      })
    );
    expect(result.tier).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.score).toBeLessThanOrEqual(7);
  });

  it("returns medium for a task with one dependency and moderate scope", () => {
    const result = scoreTaskComplexity(
      makeTask({
        subject: "Add email validation on user registration",
        description:
          "Validate email format on signup form. Show inline error message. Block submission if invalid.",
        blockedBy: ["3"],
      })
    );
    expect(result.tier).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.score).toBeLessThanOrEqual(7);
  });

  it("returns medium for an integration task with a single keyword", () => {
    const result = scoreTaskComplexity(
      makeTask({
        subject: "Integrate third-party analytics SDK",
        description:
          "Add the analytics SDK to the project and fire a page view event on route changes.",
      })
    );
    expect(result.tier).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.score).toBeLessThanOrEqual(7);
  });
});

describe("scoreTaskComplexity — complex tier (8-10)", () => {
  it("returns complex for a full refactor with many dependencies", () => {
    const result = scoreTaskComplexity(
      makeTask({
        subject: "Refactor authentication architecture",
        description:
          "Migrate the existing session-based authentication to JWT tokens. Refactor all protected routes, update middleware, redesign the token refresh pipeline, and integrate with the new distributed session store. Changes span across the entire codebase.",
        blockedBy: ["1", "2", "3"],
      })
    );
    expect(result.tier).toBe("complex");
    expect(result.score).toBeGreaterThanOrEqual(8);
  });

  it("returns complex for a dashboard migration with multiple file references", () => {
    const result = scoreTaskComplexity(
      makeTask({
        subject: "Migrate dashboard to component library",
        description:
          "Rewrite the dashboard using the new component library. Update dashboard/index.tsx, dashboard/widgets.tsx, dashboard/charts.tsx, dashboard/layout.tsx, and server/api.ts to support the new widget schema. Full end-to-end migration required.",
        blockedBy: ["5", "6"],
      })
    );
    expect(result.tier).toBe("complex");
    expect(result.score).toBeGreaterThanOrEqual(8);
  });
});

