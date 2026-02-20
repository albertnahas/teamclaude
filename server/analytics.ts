import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
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

// --- Paths ---

const ANALYTICS_PATH = join(homedir(), ".claude", "teamclaude-analytics.json");

// --- Helpers ---

function readAnalytics(): SprintRecord[] {
  if (!existsSync(ANALYTICS_PATH)) return [];
  try {
    const raw = readFileSync(ANALYTICS_PATH, "utf-8");
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
): void {
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

  const dir = dirname(ANALYTICS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ANALYTICS_PATH, JSON.stringify(records, null, 2), "utf-8");
}

export function loadSprintHistory(): SprintRecord[] {
  return readAnalytics();
}
