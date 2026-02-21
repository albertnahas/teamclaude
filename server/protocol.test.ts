import { describe, it, expect } from "vitest";
import { detectProtocol, extractContent, PROTOCOL_PATTERNS } from "./protocol";

describe("detectProtocol", () => {
  it("returns the correct key for each protocol pattern", () => {
    const cases: [string, string][] = [
      ["TASK_ASSIGNED: #1", "TASK_ASSIGNED"],
      ["READY_FOR_REVIEW: #1 — done", "READY_FOR_REVIEW"],
      ["APPROVED: #1", "APPROVED"],
      ["REQUEST_CHANGES: round 1/3 — fix it", "REQUEST_CHANGES"],
      ["RESUBMIT: #1 round 2/3 — addressed", "RESUBMIT"],
      ["ESCALATE: #1 — blocked", "ESCALATE"],
      ["ROADMAP_READY: cycle 1", "ROADMAP_READY"],
      ["SPRINT_COMPLETE: all done", "SPRINT_COMPLETE"],
      ["CYCLE_COMPLETE: cycle 2", "CYCLE_COMPLETE"],
      ["ACCEPTANCE: passed", "ACCEPTANCE"],
      ["NEXT_CYCLE: starting 3", "NEXT_CYCLE"],
    ];

    for (const [input, expected] of cases) {
      expect(detectProtocol(input), `input: "${input}"`).toBe(expected);
    }
  });

  it("returns undefined for an unrecognised string", () => {
    expect(detectProtocol("hello world")).toBeUndefined();
    expect(detectProtocol("")).toBeUndefined();
    expect(detectProtocol("task_assigned: lowercase")).toBeUndefined();
  });
});

describe("extractContent", () => {
  it("extracts text field from valid JSON", () => {
    expect(extractContent(JSON.stringify({ text: "hello" }))).toBe("hello");
  });

  it("extracts content field from valid JSON", () => {
    expect(extractContent(JSON.stringify({ content: "world" }))).toBe("world");
  });

  it("extracts summary field from valid JSON", () => {
    expect(extractContent(JSON.stringify({ summary: "brief" }))).toBe("brief");
  });

  it("extracts message field from valid JSON", () => {
    expect(extractContent(JSON.stringify({ message: "msg" }))).toBe("msg");
  });

  it("handles task_assignment JSON type", () => {
    const input = JSON.stringify({
      type: "task_assignment",
      taskId: "#3",
      subject: "write tests",
    });
    expect(extractContent(input)).toBe("TASK_ASSIGNED: #3 — write tests");
  });

  it("handles idle_notification JSON type with idleReason", () => {
    const input = JSON.stringify({ type: "idle_notification", idleReason: "no tasks" });
    expect(extractContent(input)).toBe("[idle: no tasks]");
  });

  it("handles idle_notification JSON type without idleReason", () => {
    const input = JSON.stringify({ type: "idle_notification" });
    expect(extractContent(input)).toBe("[idle: waiting]");
  });

  it("handles shutdown_request JSON type", () => {
    const input = JSON.stringify({ type: "shutdown_request" });
    expect(extractContent(input)).toBe("[shutdown requested]");
  });

  it("returns the raw string when input is not valid JSON", () => {
    const raw = "plain text message";
    expect(extractContent(raw)).toBe(raw);
  });
});
