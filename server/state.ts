import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { WebSocket } from "ws";
import { scheduleSave } from "./persistence.js";

// --- Types ---

export interface AgentInfo {
  name: string;
  agentId: string;
  agentType: string;
  status: "active" | "idle" | "unknown";
}

export interface TaskInfo {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  owner: string;
  blockedBy: string[];
  description?: string;
}

export interface Message {
  id: string;
  timestamp: number;
  from: string;
  to: string;
  content: string;
  protocol?: string;
}

export interface MergeConflict {
  engineerName: string;
  baseBranch: string;
  worktreeBranch: string;
  conflictingFiles: string[];
  timestamp: number;
}

export interface SprintState {
  teamName: string | null;
  projectName: string | null;
  agents: AgentInfo[];
  tasks: TaskInfo[];
  messages: Message[];
  paused: boolean;
  escalation: {
    taskId: string;
    reason: string;
    from: string;
    timestamp: number;
  } | null;
  mergeConflict: MergeConflict | null;
  mode: "manual" | "autonomous";
  cycle: number;
  phase: "idle" | "analyzing" | "sprinting" | "validating";
  reviewTaskIds: string[];
  tokenUsage: {
    total: number;
    byAgent: Record<string, number>;
    estimatedCostUsd: number;
  };
  checkpoints: string[];
  pendingCheckpoint: { taskId: string; taskSubject: string } | null;
  tmuxAvailable: boolean;
  tmuxSessionName: string | null;
  tokenBudgetApproaching?: boolean;
  tokenBudgetExceeded?: boolean;
  webhookStatus?: {
    lastEvent?: string;
    lastStatus?: "success" | "error";
    lastError?: string;
    deliveryCount: number;
  };
}

export type WsEvent =
  | { type: "init"; state: SprintState }
  | { type: "task_updated"; task: TaskInfo }
  | { type: "message_sent"; message: Message }
  | { type: "agent_status"; agent: AgentInfo }
  | { type: "paused"; paused: boolean }
  | { type: "escalation"; escalation: SprintState["escalation"] }
  | { type: "merge_conflict"; mergeConflict: MergeConflict | null }
  | {
      type: "cycle_info";
      cycle: number;
      phase: SprintState["phase"];
      mode: SprintState["mode"];
    }
  | { type: "token_usage"; usage: SprintState["tokenUsage"] }
  | { type: "checkpoint"; checkpoint: SprintState["pendingCheckpoint"] }
  | { type: "validation"; validation: { passed: boolean; results: { name: string; command: string; passed: boolean; output: string }[] } }
  | { type: "process_started"; pid: number }
  | { type: "process_exited"; code: number | null }
  | { type: "terminal_output"; agentName: string; paneIndex: number; content: string }
  | { type: "panes_discovered"; panes: { agentName: string | null; paneIndex: number }[] }
  | { type: "webhook_status"; status: SprintState["webhookStatus"] }
  | { type: "token_budget_approaching"; usage: SprintState["tokenUsage"] }
  | { type: "token_budget_exceeded"; usage: SprintState["tokenUsage"] }
  | { type: "replay_complete" }
  | { type: "replay_start"; totalEvents: number };

// --- State ---

export const state: SprintState = {
  teamName: null,
  projectName: null,
  agents: [],
  tasks: [],
  messages: [],
  paused: false,
  escalation: null,
  mergeConflict: null,
  mode: "manual",
  cycle: 0,
  phase: "idle",
  reviewTaskIds: [],
  tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
  checkpoints: [],
  pendingCheckpoint: null,
  tmuxAvailable: false,
  tmuxSessionName: null,
  webhookStatus: { deliveryCount: 0 },
};

export const inboxCursors = new Map<string, number>();
export const clients = new Set<WebSocket>();
export const taskProtocolOverrides = new Map<
  string,
  { status: TaskInfo["status"]; owner: string }
>();

export let teamInitMessageSent = false;
export function setTeamInitMessageSent(value: boolean) {
  teamInitMessageSent = value;
}

// --- Recording hook ---

let recordHook: ((event: WsEvent) => void) | null = null;

export function setRecordHook(fn: ((event: WsEvent) => void) | null) {
  recordHook = fn;
}

// --- Helpers ---

export function safeReadJSON(path: string): unknown | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function broadcast(event: WsEvent) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
  // Persist on every state mutation (debounced)
  if (event.type !== "terminal_output" && event.type !== "panes_discovered") {
    scheduleSave(state);
    recordHook?.(event);
  }
}

export function detectProjectName(cwd: string = process.cwd()): string {
  const manifests: { file: string; key: string }[] = [
    { file: "package.json", key: "name" },
    { file: "Cargo.toml", key: "name" },
    { file: "pyproject.toml", key: "name" },
  ];
  for (const { file, key } of manifests) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      if (file.endsWith(".json")) {
        return JSON.parse(raw)[key] || basename(cwd);
      }
      // TOML: simple regex for name = "value"
      const m = raw.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
      if (m) return m[1];
    } catch {}
  }
  // Fallback: go.mod first line
  const goMod = join(cwd, "go.mod");
  if (existsSync(goMod)) {
    try {
      const first = readFileSync(goMod, "utf-8").split("\n")[0];
      const m = first.match(/^module\s+(\S+)/);
      if (m) return m[1].split("/").pop()!;
    } catch {}
  }
  return basename(cwd);
}

export function resetState() {
  state.teamName = null;
  state.projectName = null;
  state.agents = [];
  state.tasks = [];
  state.messages = [];
  state.mode = "manual";
  state.paused = false;
  state.escalation = null;
  state.mergeConflict = null;
  state.cycle = 0;
  state.phase = "idle";
  state.reviewTaskIds = [];
  state.tokenUsage = { total: 0, byAgent: {}, estimatedCostUsd: 0 };
  state.checkpoints = [];
  state.pendingCheckpoint = null;
  state.tmuxSessionName = null;
  state.tokenBudgetApproaching = false;
  state.tokenBudgetExceeded = false;
  state.webhookStatus = { deliveryCount: 0 };
  setTeamInitMessageSent(false);
  taskProtocolOverrides.clear();
  inboxCursors.clear();
}
