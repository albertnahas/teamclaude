import { readFileSync } from "node:fs";
import type { WebSocket } from "ws";

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

export interface SprintState {
  teamName: string | null;
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
  mode: "manual" | "autonomous";
  cycle: number;
  phase: "idle" | "analyzing" | "sprinting" | "validating";
  reviewTaskIds: string[];
}

export type WsEvent =
  | { type: "init"; state: SprintState }
  | { type: "task_updated"; task: TaskInfo }
  | { type: "message_sent"; message: Message }
  | { type: "agent_status"; agent: AgentInfo }
  | { type: "paused"; paused: boolean }
  | { type: "escalation"; escalation: SprintState["escalation"] }
  | {
      type: "cycle_info";
      cycle: number;
      phase: SprintState["phase"];
      mode: SprintState["mode"];
    }
  | { type: "process_started"; pid: number }
  | { type: "process_exited"; code: number | null };

// --- State ---

export const state: SprintState = {
  teamName: null,
  agents: [],
  tasks: [],
  messages: [],
  paused: false,
  escalation: null,
  mode: "manual",
  cycle: 0,
  phase: "idle",
  reviewTaskIds: [],
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
}

export function resetState() {
  state.teamName = null;
  state.agents = [];
  state.tasks = [];
  state.messages = [];
  state.paused = false;
  state.escalation = null;
  state.cycle = 0;
  state.phase = "idle";
  state.reviewTaskIds = [];
  setTeamInitMessageSent(false);
  taskProtocolOverrides.clear();
  inboxCursors.clear();
}
