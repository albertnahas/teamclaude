import { describe, it, expect, beforeEach } from "vitest";
import {
  isSprintComplete,
  setSprintComplete,
  resetSprintCompleteFlag,
} from "./sprint-guard.js";

describe("sprint-guard", () => {
  beforeEach(() => {
    resetSprintCompleteFlag();
  });

  it("initial state is false", () => {
    expect(isSprintComplete()).toBe(false);
  });

  it("setSprintComplete makes isSprintComplete return true", () => {
    setSprintComplete();
    expect(isSprintComplete()).toBe(true);
  });

  it("resetSprintCompleteFlag resets to false", () => {
    setSprintComplete();
    resetSprintCompleteFlag();
    expect(isSprintComplete()).toBe(false);
  });

  it("multiple set calls are idempotent", () => {
    setSprintComplete();
    setSprintComplete();
    setSprintComplete();
    expect(isSprintComplete()).toBe(true);
    resetSprintCompleteFlag();
    expect(isSprintComplete()).toBe(false);
  });
});
