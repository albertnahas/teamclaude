import { describe, it, expect } from "vitest";
import { recommendEngineers, type ExecutionPlan } from "./planner.js";

function plan(batches: string[][]): ExecutionPlan {
  return { batches, criticalPath: [], timeline: "" };
}

describe("recommendEngineers", () => {
  it("returns max batch size for all-independent tasks", () => {
    expect(recommendEngineers(plan([["1", "2", "3", "4"]]))).toBe(4);
  });

  it("returns 1 for fully sequential tasks", () => {
    expect(recommendEngineers(plan([["1"], ["2"], ["3"], ["4"]]))).toBe(1);
  });

  it("returns widest batch for mixed batches", () => {
    expect(recommendEngineers(plan([["1", "2"], ["3"], ["4", "5", "6"]]))).toBe(3);
  });

  it("returns 1 for empty plan", () => {
    expect(recommendEngineers(plan([]))).toBe(1);
  });

  it("caps at maxEngineers (default 5)", () => {
    expect(recommendEngineers(plan([["1", "2", "3", "4", "5", "6", "7"]]))).toBe(5);
  });

  it("respects custom maxEngineers", () => {
    expect(recommendEngineers(plan([["1", "2", "3", "4"]]), 3)).toBe(3);
  });
});
