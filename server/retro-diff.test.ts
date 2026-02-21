import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("./storage.js", () => ({
  historyDir: vi.fn(() => "/fake/history"),
}));

vi.mock("./retro.js", () => ({
  parseRetro: vi.fn(),
}));

const { readFile } = await import("node:fs/promises");
const { parseRetro } = await import("./retro.js");
const { diffRetros } = await import("./retro-diff.js");

const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockParseRetro = parseRetro as unknown as ReturnType<typeof vi.fn>;

function makeRetroJSON(overrides: Record<string, any> = {}) {
  return {
    summary: {
      totalTasks: 5,
      completedTasks: 4,
      completionRate: 80,
      avgReviewRounds: 1.5,
    },
    completed: ["Task A", "Task B"],
    incomplete: ["Task C"],
    highlights: ["Task A", "Task B"],
    recommendations: ["Task C"],
    raw: "# Sprint Retrospective\n",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("diffRetros", () => {
  it("returns null when sprint A is not found", async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT"))  // sprint A
      .mockResolvedValueOnce("# Retro B\n");        // sprint B
    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result).toBeNull();
  });

  it("returns null when sprint B is not found", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")        // sprint A
      .mockRejectedValueOnce(new Error("ENOENT")); // sprint B
    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result).toBeNull();
  });

  it("returns null when both sprints are not found", async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockRejectedValueOnce(new Error("ENOENT"));
    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result).toBeNull();
  });

  it("computes positive completion rate delta (improved)", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 5, completedTasks: 3, completionRate: 60, avgReviewRounds: 2 } }))
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 5, completedTasks: 5, completionRate: 100, avgReviewRounds: 1 } }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result).not.toBeNull();
    expect(result!.delta.completionRate).toBe(40);  // 100 - 60
    expect(result!.delta.avgReviewRounds).toBe(-1); // 1 - 2 (negative = improved)
  });

  it("computes negative completion rate delta (regression)", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 4, completedTasks: 4, completionRate: 100, avgReviewRounds: 1 } }))
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 4, completedTasks: 2, completionRate: 50, avgReviewRounds: 3 } }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.delta.completionRate).toBe(-50);
    expect(result!.delta.avgReviewRounds).toBe(2);
  });

  it("computes taskCount delta", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 3, completedTasks: 3, completionRate: 100, avgReviewRounds: 0 } }))
      .mockReturnValueOnce(makeRetroJSON({ summary: { totalTasks: 7, completedTasks: 7, completionRate: 100, avgReviewRounds: 0 } }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.delta.taskCount).toBe(4);
  });

  it("identifies commonIssues (recommendations in both)", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Slow reviews", "Missing tests"] }))
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Slow reviews", "Poor docs"] }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.commonIssues).toEqual(["Slow reviews"]);
  });

  it("identifies resolved issues (in A but not B)", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Bug in login", "Missing tests"] }))
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Missing tests"] }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.resolved).toEqual(["Bug in login"]);
  });

  it("identifies newIssues (in B but not A)", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Missing tests"] }))
      .mockReturnValueOnce(makeRetroJSON({ recommendations: ["Missing tests", "Slow CI"] }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.newIssues).toEqual(["Slow CI"]);
  });

  it("returns correct sprint IDs in result", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON())
      .mockReturnValueOnce(makeRetroJSON());

    const result = await diffRetros("sprint-20260101", "sprint-20260201");
    expect(result!.sprintA.id).toBe("sprint-20260101");
    expect(result!.sprintB.id).toBe("sprint-20260201");
  });

  it("handles empty recommendations gracefully", async () => {
    mockReadFile
      .mockResolvedValueOnce("# Retro A\n")
      .mockResolvedValueOnce("# Retro B\n");
    mockParseRetro
      .mockReturnValueOnce(makeRetroJSON({ recommendations: [] }))
      .mockReturnValueOnce(makeRetroJSON({ recommendations: [] }));

    const result = await diffRetros("sprint-A", "sprint-B");
    expect(result!.commonIssues).toHaveLength(0);
    expect(result!.resolved).toHaveLength(0);
    expect(result!.newIssues).toHaveLength(0);
  });
});
