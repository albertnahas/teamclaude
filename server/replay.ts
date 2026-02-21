/**
 * Sprint Replay — record and replay sprint sessions in the dashboard.
 *
 * Recording format (.jsonl file — one JSON object per line):
 *   {"timestamp":0,"event":{"type":"init","state":{...}}}
 *   {"timestamp":1234,"event":{"type":"task_updated","task":{...}}}
 *   ...
 *
 * - `timestamp` is milliseconds elapsed since the first event (always 0 for the first).
 * - Events are replayed with relative timing divided by the speed multiplier.
 * - `terminal_output` and `panes_discovered` events are excluded from recordings
 *   (too verbose; not useful for replay).
 * - Files are written append-only during a live sprint (one line per event).
 * - Stored at `.teamclaude/history/<sprint-id>/replay.jsonl`.
 *
 * Auto-recording (opt-in via .sprint.yml):
 *   recording:
 *     enabled: true
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WebSocket } from "ws";
import type { WsEvent } from "./state.js";

// --- Types ---

export interface RecordedEvent {
  /** Milliseconds elapsed since the recording started (first event = 0) */
  timestamp: number;
  event: WsEvent;
}

export interface Recording {
  events: RecordedEvent[];
}

// --- Load ---

export function loadRecording(file: string): Recording {
  const raw = readFileSync(file, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`Empty recording file: ${file}`);

  const events: RecordedEvent[] = lines.map((line, i) => {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.timestamp !== "number" || !parsed.event?.type) {
        throw new Error(`Invalid entry at line ${i + 1}`);
      }
      return parsed as RecordedEvent;
    } catch (err: any) {
      throw new Error(`Invalid recording format in ${file}: ${err.message}`);
    }
  });

  return { events };
}

// --- Append (live recording) ---

/**
 * Append a single event line to a .jsonl replay file.
 * Creates the parent directory if needed.
 */
export function appendEventToReplay(file: string, entry: RecordedEvent): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}

// --- Replay ---

/**
 * Replay a recording to a single WebSocket client.
 * Events are sent with relative timing divided by `speed`.
 * Returns a cleanup function that cancels the replay.
 */
export function startReplay(
  recording: Recording,
  client: WebSocket,
  speed: number = 10
): () => void {
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const send = (data: string) => {
    if (cancelled) return;
    if (client.readyState === client.OPEN) client.send(data);
  };

  // Send replay_start so the client knows the total event count for progress tracking
  send(JSON.stringify({ type: "replay_start", totalEvents: recording.events.length }));

  for (const entry of recording.events) {
    const delay = entry.timestamp / speed;
    const t = setTimeout(() => send(JSON.stringify(entry.event)), delay);
    timeouts.push(t);
  }

  // Send replay_complete marker after last event
  const totalDuration =
    recording.events.length > 0
      ? recording.events[recording.events.length - 1].timestamp / speed
      : 0;
  const done = setTimeout(() => {
    send(JSON.stringify({ type: "replay_complete" }));
  }, totalDuration + 100);
  timeouts.push(done);

  return () => {
    cancelled = true;
    for (const t of timeouts) clearTimeout(t);
  };
}

// --- Recorder (in-memory accumulator used during live sprint) ---

const EXCLUDED_EVENT_TYPES = new Set(["terminal_output", "panes_discovered"]);

export class Recorder {
  private startTime: number | null = null;
  private file: string | null = null;

  /**
   * Attach a file path — subsequent `record()` calls append to this file.
   * Call before the sprint starts.
   */
  attach(file: string): void {
    this.file = file;
    this.startTime = null;
  }

  record(event: WsEvent): void {
    if (EXCLUDED_EVENT_TYPES.has(event.type)) return;
    if (!this.file) return;
    const now = Date.now();
    if (this.startTime === null) this.startTime = now;
    const entry: RecordedEvent = { timestamp: now - this.startTime, event };
    appendEventToReplay(this.file, entry);
  }

  reset(): void {
    this.startTime = null;
    this.file = null;
  }
}
