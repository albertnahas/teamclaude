import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { analyticsPath, ensureStorageDir, ensureSprintHistoryDir } from "./storage.js";
import type { SprintState } from "./state.js";

// --- Types ---

export interface SprintRecord {
  sprintId: string;
  startedAt: string;
  completedAt: string;
  cycle: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  avgReviewRoundsPerTask: number;
  totalMessages: number;
  agents: string[];
}

// --- Helpers ---

function readAnalytics(): SprintRecord[] {
  const path = analyticsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SprintRecord[]) : [];
  } catch {
    return [];
  }
}

function computeAvgReviewRounds(state: SprintState): number {
  const completedTasks = state.tasks.filter((t) => t.status === "completed");
  if (completedTasks.length === 0) return 0;

  let totalRounds = 0;
  for (const task of completedTasks) {
    const resubmitCount = state.messages.filter(
      (m) => m.protocol === "RESUBMIT" && m.content.includes(`#${task.id}`)
    ).length;
    totalRounds += resubmitCount;
  }

  return Math.round((totalRounds / completedTasks.length) * 100) / 100;
}

// --- Public API ---

export function recordSprintCompletion(
  state: SprintState,
  startedAt?: number
): SprintRecord {
  const records = readAnalytics();

  const record: SprintRecord = {
    sprintId: `${state.teamName ?? "unknown"}-${Date.now()}`,
    startedAt: new Date(startedAt ?? Date.now()).toISOString(),
    completedAt: new Date().toISOString(),
    cycle: state.cycle,
    totalTasks: state.tasks.length,
    completedTasks: state.tasks.filter((t) => t.status === "completed").length,
    blockedTasks: state.tasks.filter((t) => t.blockedBy.length > 0).length,
    avgReviewRoundsPerTask: computeAvgReviewRounds(state),
    totalMessages: state.messages.length,
    agents: state.agents.map((a) => a.name),
  };

  records.push(record);

  ensureStorageDir();
  writeFileSync(analyticsPath(), JSON.stringify(records, null, 2), "utf-8");

  return record;
}

export function loadSprintHistory(): SprintRecord[] {
  return readAnalytics();
}

export function saveSprintSnapshot(
  sprintId: string,
  state: SprintState
): void {
  const dir = ensureSprintHistoryDir(sprintId);
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify(state.tasks, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(dir, "messages.json"),
    JSON.stringify(state.messages, null, 2),
    "utf-8"
  );
}

export function saveRetroToHistory(sprintId: string, retro: string): void {
  const dir = ensureSprintHistoryDir(sprintId);
  writeFileSync(join(dir, "retro.md"), retro, "utf-8");
}

export function saveRecordToHistory(
  sprintId: string,
  record: SprintRecord
): void {
  const dir = ensureSprintHistoryDir(sprintId);
  writeFileSync(
    join(dir, "record.json"),
    JSON.stringify(record, null, 2),
    "utf-8"
  );
}

/**
 * One-time migration: import records from the legacy global analytics file
 * (~/.claude/teamclaude-analytics.json) into the local .teamclaude/analytics.json.
 * Only runs if the local file does not yet exist.
 */
export function migrateGlobalAnalytics(): void {
  if (existsSync(analyticsPath())) return;

  const globalPath = join(homedir(), ".claude", "teamclaude-analytics.json");
  if (!existsSync(globalPath)) return;

  try {
    const raw = readFileSync(globalPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    ensureStorageDir();
    writeFileSync(analyticsPath(), JSON.stringify(parsed, null, 2), "utf-8");
    console.log(`[analytics] Migrated ${parsed.length} records from global analytics`);
  } catch {
    // Silent — migration is best-effort
  }
}
