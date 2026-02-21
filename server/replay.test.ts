import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadRecording,
  appendEventToReplay,
  startReplay,
  Recorder,
  type RecordedEvent,
} from "./replay.js";
import type { WsEvent } from "./state.js";

// --- Fixtures ---

const tmpDir = mkdtempSync(join(tmpdir(), "tc-replay-test-"));

function makeEvent(type: WsEvent["type"], extra: object = {}): WsEvent {
  if (type === "init") {
    return { type: "init", state: { teamName: "t", projectName: "p", agents: [], tasks: [], messages: [], paused: false, escalation: null, mergeConflict: null, mode: "manual", cycle: 1, phase: "idle", reviewTaskIds: [], tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 }, checkpoints: [], pendingCheckpoint: null, tmuxAvailable: false, tmuxSessionName: null, ...extra } };
  }
  if (type === "paused") return { type: "paused", paused: false, ...extra } as WsEvent;
  return { type: "process_started", pid: 0, ...extra } as WsEvent;
}

// --- loadRecording ---

describe("loadRecording", () => {
  it("loads a valid .jsonl recording file", () => {
    const lines = [
      JSON.stringify({ timestamp: 0, event: makeEvent("paused") }),
      JSON.stringify({ timestamp: 1000, event: { type: "process_started", pid: 1 } }),
    ];
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, lines.join("\n") + "\n", "utf-8");

    const loaded = loadRecording(file);
    expect(loaded.events).toHaveLength(2);
    expect(loaded.events[0].timestamp).toBe(0);
    expect(loaded.events[0].event.type).toBe("paused");
    expect(loaded.events[1].timestamp).toBe(1000);
  });

  it("throws on invalid line format", () => {
    const file = join(tmpDir, "bad.jsonl");
    writeFileSync(file, '{"timestamp":0,"event":{"type":"paused","paused":false}}\nnot-json\n', "utf-8");

    expect(() => loadRecording(file)).toThrow("Invalid recording format");
  });

  it("throws on empty file", () => {
    const file = join(tmpDir, "empty.jsonl");
    writeFileSync(file, "", "utf-8");

    expect(() => loadRecording(file)).toThrow("Empty recording file");
  });

  it("throws on non-existent file", () => {
    expect(() => loadRecording(join(tmpDir, "missing.jsonl"))).toThrow();
  });

  it("ignores trailing blank lines", () => {
    const file = join(tmpDir, "trailing.jsonl");
    writeFileSync(file, JSON.stringify({ timestamp: 0, event: makeEvent("paused") }) + "\n\n", "utf-8");

    const loaded = loadRecording(file);
    expect(loaded.events).toHaveLength(1);
  });
});

// --- appendEventToReplay ---

describe("appendEventToReplay", () => {
  it("creates file and writes a single JSONL line", () => {
    const file = join(tmpDir, "append-test.jsonl");
    const entry: RecordedEvent = { timestamp: 0, event: makeEvent("paused") };

    appendEventToReplay(file, entry);

    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.timestamp).toBe(0);
    expect(parsed.event.type).toBe("paused");
  });

  it("appends multiple lines to the same file", () => {
    const file = join(tmpDir, "multi-append.jsonl");
    appendEventToReplay(file, { timestamp: 0, event: makeEvent("paused") });
    appendEventToReplay(file, { timestamp: 500, event: { type: "process_started", pid: 1 } });

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).timestamp).toBe(500);
  });

  it("creates parent directories if they do not exist", () => {
    const file = join(tmpDir, "nested", "deep", "replay.jsonl");
    appendEventToReplay(file, { timestamp: 0, event: makeEvent("paused") });
    expect(existsSync(file)).toBe(true);
  });
});

// --- startReplay ---

describe("startReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends replay_start with total event count immediately", () => {
    const sent: WsEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) } as any;

    const events: RecordedEvent[] = [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 100, event: { type: "process_started", pid: 1 } },
    ];

    startReplay({ events }, ws, 1);

    // replay_start is sent synchronously before any timer fires
    expect(sent[0]).toEqual({ type: "replay_start", totalEvents: 2 });
  });

  it("sends events in timestamp order", async () => {
    const sent: WsEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) } as any;

    const events: RecordedEvent[] = [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 100, event: { type: "process_started", pid: 1 } },
      { timestamp: 200, event: { type: "process_exited", code: 0 } },
    ];

    startReplay({ events }, ws, 1);
    // sent[0] is replay_start

    vi.advanceTimersByTime(0);
    expect(sent).toHaveLength(2); // replay_start + first event
    expect(sent[1].type).toBe("paused");

    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(3);
    expect(sent[2].type).toBe("process_started");

    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(4);
    expect(sent[3].type).toBe("process_exited");
  });

  it("respects speed multiplier — 2x halves the delay", () => {
    const sent: WsEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) } as any;

    const events: RecordedEvent[] = [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 1000, event: { type: "process_started", pid: 1 } },
    ];

    startReplay({ events }, ws, 2);
    // sent[0] is replay_start

    // At 499ms real-time, 2x would be 998ms recorded — not yet
    vi.advanceTimersByTime(499);
    expect(sent).toHaveLength(2); // replay_start + first event at t=0

    // At 500ms real-time = 1000ms recorded — second event fires
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(3);
    expect(sent[2].type).toBe("process_started");
  });

  it("uses default speed of 10x", () => {
    const sent: WsEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) } as any;

    // 1000ms recorded → 100ms real-time at 10x
    startReplay({ events: [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 1000, event: { type: "process_started", pid: 1 } },
    ]}, ws);
    // sent[0] is replay_start

    vi.advanceTimersByTime(99);
    expect(sent).toHaveLength(2); // replay_start + first event

    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(3);
  });

  it("sends replay_complete after all events", () => {
    const sent: string[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(data) } as any;

    const events: RecordedEvent[] = [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 500, event: { type: "process_started", pid: 1 } },
    ];

    startReplay({ events }, ws, 1);
    vi.advanceTimersByTime(700); // 500ms + 100ms buffer + margin

    const types = sent.map((s) => JSON.parse(s).type);
    expect(types).toContain("replay_complete");
  });

  it("cancel function stops further events", () => {
    const sent: WsEvent[] = [];
    const ws = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(JSON.parse(data)) } as any;

    const events: RecordedEvent[] = [
      { timestamp: 0, event: makeEvent("paused") },
      { timestamp: 500, event: { type: "process_started", pid: 1 } },
    ];

    const cancel = startReplay({ events }, ws, 1);
    // replay_start sent synchronously; advance to fire t=0 event
    vi.advanceTimersByTime(0);
    expect(sent).toHaveLength(2); // replay_start + paused

    cancel();
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(2); // no further events after cancel
  });

  it("does not send to a closed WebSocket", () => {
    const closed = { readyState: 3, OPEN: 1, send: vi.fn() } as any;

    startReplay({ events: [{ timestamp: 0, event: makeEvent("paused") }] }, closed, 1);
    vi.advanceTimersByTime(200);

    expect(closed.send).not.toHaveBeenCalled();
  });

  it("handles empty recording without error", () => {
    const ws = { readyState: 1, OPEN: 1, send: vi.fn() } as any;
    expect(() => startReplay({ events: [] }, ws, 1)).not.toThrow();
    vi.advanceTimersByTime(200);
  });
});

// --- Recorder ---

describe("Recorder", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("records events as JSONL lines appended to file", () => {
    const rec = new Recorder();
    const file = join(tmpDir, "recorder-test.jsonl");
    rec.attach(file);

    rec.record({ type: "paused", paused: true });
    vi.advanceTimersByTime(500);
    rec.record({ type: "process_started", pid: 1 });
    vi.advanceTimersByTime(300);
    rec.record({ type: "process_exited", code: 0 });

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);

    const entries = lines.map((l) => JSON.parse(l));
    expect(entries[0].timestamp).toBe(0);
    expect(entries[1].timestamp).toBe(500);
    expect(entries[2].timestamp).toBe(800);
  });

  it("does nothing when not attached", () => {
    const rec = new Recorder();
    expect(() => rec.record({ type: "paused", paused: true })).not.toThrow();
  });

  it("excludes terminal_output events", () => {
    const rec = new Recorder();
    const file = join(tmpDir, "recorder-excluded-terminal.jsonl");
    rec.attach(file);
    rec.record({ type: "terminal_output", agentName: "eng", paneIndex: 0, content: "hello" });
    expect(existsSync(file)).toBe(false);
  });

  it("excludes panes_discovered events", () => {
    const rec = new Recorder();
    const file = join(tmpDir, "recorder-excluded-panes.jsonl");
    rec.attach(file);
    rec.record({ type: "panes_discovered", panes: [] });
    expect(existsSync(file)).toBe(false);
  });

  it("reset detaches file and resets start time", () => {
    const rec = new Recorder();
    const file1 = join(tmpDir, "recorder-reset1.jsonl");
    rec.attach(file1);
    rec.record({ type: "paused", paused: true });
    rec.reset();

    // After reset, no file should be written
    const file2 = join(tmpDir, "recorder-reset2.jsonl");
    rec.attach(file2);
    vi.advanceTimersByTime(1000);
    rec.record({ type: "paused", paused: false });

    const lines = readFileSync(file2, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).timestamp).toBe(0); // new start time after reset
  });
});
