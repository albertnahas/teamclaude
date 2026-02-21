// Shared types mirrored from server/state.ts

export interface ModelRoutingDecision {
  model: string;
  tier: "simple" | "medium" | "complex";
  score: number;
  reason: string;
}

// Cost per million tokens (MTok). Source: https://www.anthropic.com/pricing (Feb 2025)
export const MODEL_COST: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-6":         { input: 3,    output: 15 },
  "claude-opus-4-6":           { input: 15,   output: 75 },
};
// Fallback display names
export const MODEL_LABEL: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku",
  "claude-sonnet-4-6":         "Sonnet",
  "claude-opus-4-6":           "Opus",
};

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
  model?: string;
  estimatedCostUsd?: number;
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
  validatingTaskIds: string[];
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
  | { type: "task_validation"; taskId: string; passed: boolean; output: string }
  | { type: "webhook_status"; status: SprintState["webhookStatus"] }
  | { type: "token_budget_approaching"; usage: SprintState["tokenUsage"] }
  | { type: "token_budget_exceeded"; usage: SprintState["tokenUsage"] }
  | { type: "replay_complete" }
  | { type: "replay_start"; totalEvents: number };

export type AppPhase = "setup" | "planning" | "sprint" | "replay";
