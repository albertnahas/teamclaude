import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { learningsPath, processLearningsPath, ensureStorageDir } from "./storage.js";
import type { SprintState } from "./state.js";
import type { SprintRecord } from "./analytics.js";

// --- Types ---

export type LearningRole = "pm" | "manager" | "engineer";
export type LearningSource = "signal" | "agent";

export interface ProcessLearning {
  id: string;
  signal: string;
  source: LearningSource;
  role: LearningRole;
  action: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  sprintIds: string[];
}

export interface LearningsStore {
  version: 1;
  learnings: ProcessLearning[];
}

export interface RoleLearnings {
  orchestrator: string;
  pm: string;
  manager: string;
  engineer: string;
}

// --- Signal Registry ---

interface SignalLearning {
  role: LearningRole;
  action: string;
}

interface Signal {
  detect: (state: SprintState, record: SprintRecord) => boolean;
  learnings: SignalLearning[];
}

export const SIGNALS: Record<string, Signal> = {
  LOW_COMPLETION_RATE: {
    detect: (_state, record) => {
      if (record.totalTasks === 0) return false;
      return record.completedTasks / record.totalTasks < 0.6;
    },
    learnings: [
      { role: "pm", action: "Break tasks into smaller, independently-shippable units. Each task should be completable in one review cycle." },
      { role: "manager", action: "When task progress stalls past 50% of sprint duration, escalate rather than waiting for engineer self-report." },
      { role: "engineer", action: "If you cannot complete a task, send READY_FOR_REVIEW with partial progress and a clear description of what remains." },
    ],
  },
  HIGH_REVIEW_ROUNDS: {
    detect: (_state, record) => record.avgReviewRoundsPerTask > 1.5,
    learnings: [
      { role: "pm", action: "Include explicit acceptance criteria in every task with exact verification commands." },
      { role: "manager", action: "On first REQUEST_CHANGES, provide ALL feedback at once — do not drip-feed across rounds." },
      { role: "engineer", action: "Before READY_FOR_REVIEW, run test and type-check commands. Verify against acceptance criteria yourself." },
    ],
  },
  ESCALATION_OCCURRED: {
    detect: (state) => state.messages.some((m) => m.protocol === "ESCALATE" || m.protocol === "ESCALATION"),
    learnings: [
      { role: "pm", action: "For complex tasks, include a hints section with relevant file paths and function signatures." },
      { role: "manager", action: "Before assigning, verify the engineer has all required context. Share relevant file paths proactively." },
    ],
  },
  UNBALANCED_WORKLOAD: {
    detect: (state) => {
      const owners = state.tasks
        .filter((t) => t.owner && t.status !== "deleted")
        .map((t) => t.owner);
      if (owners.length < 2) return false;
      const counts = new Map<string, number>();
      for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
      const uniqueOwners = counts.size;
      if (uniqueOwners < 2) return false;
      const max = Math.max(...counts.values());
      return max / owners.length > 0.6;
    },
    learnings: [
      { role: "manager", action: "Distribute tasks evenly with strict round-robin. Max N/(E+1) tasks per engineer." },
    ],
  },
  BLOCKED_TASKS_AT_END: {
    detect: (state) =>
      state.tasks.some(
        (t) =>
          t.status !== "completed" &&
          t.status !== "deleted" &&
          t.blockedBy.length > 0
      ),
    learnings: [
      { role: "pm", action: "Order tasks so dependency targets come first. Ensure blocking tasks have unambiguous acceptance criteria." },
      { role: "manager", action: "Prioritize assigning blocking tasks first. Check blockedBy before distributing." },
    ],
  },
  STALE_TASKS: {
    detect: (state) => {
      const inProgress = state.tasks.filter((t) => t.status === "in_progress");
      if (inProgress.length === 0 || state.messages.length === 0) return false;
      const timestamps = state.messages.map((m) => m.timestamp);
      const earliest = Math.min(...timestamps);
      const latest = Math.max(...timestamps);
      const timeline = latest - earliest;
      if (timeline <= 0) return false;
      const midpoint = earliest + timeline * 0.5;
      return inProgress.some((t) => {
        const taskMsgs = state.messages.filter(
          (m) =>
            (m.from === t.owner || m.to === t.owner) &&
            m.protocol &&
            m.timestamp > midpoint
        );
        return taskMsgs.length === 0;
      });
    },
    learnings: [
      { role: "manager", action: "Poll engineers for progress if no READY_FOR_REVIEW arrives within a reasonable window." },
      { role: "engineer", action: "If stuck, send ESCALATE immediately with the specific blocker." },
    ],
  },
  ZERO_TASKS_CREATED: {
    detect: (_state, record) => record.totalTasks === 0,
    learnings: [
      { role: "pm", action: "Always create at least one concrete task via TaskCreate, even with vague roadmap." },
    ],
  },
};

// --- Store I/O ---

export function loadProcessLearnings(): LearningsStore {
  const path = processLearningsPath();
  if (!existsSync(path)) return { version: 1, learnings: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (raw.version === 1 && Array.isArray(raw.learnings)) return raw as LearningsStore;
    return { version: 1, learnings: [] };
  } catch {
    return { version: 1, learnings: [] };
  }
}

function saveProcessLearnings(store: LearningsStore): void {
  ensureStorageDir();
  writeFileSync(processLearningsPath(), JSON.stringify(store, null, 2), "utf-8");
}

// --- Hashing ---

export function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// --- Extraction ---

function upsertLearning(
  store: LearningsStore,
  id: string,
  signal: string,
  source: LearningSource,
  role: LearningRole,
  action: string,
  sprintId: string
): void {
  const now = new Date().toISOString();
  const existing = store.learnings.find((l) => l.id === id);
  if (existing) {
    existing.frequency++;
    existing.lastSeen = now;
    if (!existing.sprintIds.includes(sprintId)) {
      existing.sprintIds.push(sprintId);
    }
  } else {
    store.learnings.push({
      id,
      signal,
      source,
      role,
      action,
      frequency: 1,
      firstSeen: now,
      lastSeen: now,
      sprintIds: [sprintId],
    });
  }
}

export function parseAgentLearnings(
  messages: SprintState["messages"]
): { role: LearningRole; action: string }[] {
  const results: { role: LearningRole; action: string }[] = [];
  const validRoles = new Set<string>(["pm", "manager", "engineer"]);

  for (const msg of messages) {
    if (msg.protocol !== "PROCESS_LEARNING") continue;
    const match = msg.content.match(
      /^PROCESS_LEARNING:\s*(pm|manager|engineer)\s*[—–-]\s*(.+)/i
    );
    if (!match) continue;
    const role = match[1].toLowerCase() as LearningRole;
    if (!validRoles.has(role)) continue;
    const action = match[2].trim();
    if (action) results.push({ role, action });
  }

  return results.slice(0, 5); // Cap at 5 per sprint
}

export function extractProcessLearnings(
  state: SprintState,
  record: SprintRecord,
  sprintId: string
): LearningsStore {
  const store = loadProcessLearnings();

  // 1. Run signal detection
  for (const [key, signal] of Object.entries(SIGNALS)) {
    if (!signal.detect(state, record)) continue;
    for (const { role, action } of signal.learnings) {
      upsertLearning(store, `${key}:${role}`, key, "signal", role, action, sprintId);
    }
  }

  // 2. Parse agent reflections
  const agentLearnings = parseAgentLearnings(state.messages);
  for (const { role, action } of agentLearnings) {
    const normalized = action.trim().toLowerCase();
    const id = `AGENT:${simpleHash(normalized + role)}`;
    upsertLearning(store, id, "AGENT_REFLECTION", "agent", role, action, sprintId);
  }

  saveProcessLearnings(store);
  return store;
}

/** Remove a learning by ID, return true if found */
export function saveAndRemoveLearning(id: string): boolean {
  const store = loadProcessLearnings();
  const idx = store.learnings.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  store.learnings.splice(idx, 1);
  saveProcessLearnings(store);
  return true;
}

// --- Role-filtered Retrieval ---

function formatLearnings(learnings: ProcessLearning[]): string {
  if (learnings.length === 0) return "";
  return learnings
    .map((l) => `- [\u00d7${l.frequency}] ${l.action}`)
    .join("\n");
}

export function getRoleLearnings(maxPerRole: number = 5): RoleLearnings {
  const store = loadProcessLearnings();
  const sorted = [...store.learnings].sort((a, b) => b.frequency - a.frequency);

  const byRole = (role: LearningRole) =>
    formatLearnings(sorted.filter((l) => l.role === role).slice(0, maxPerRole));

  // Orchestrator gets high-frequency cross-role items
  const crossRole = sorted.filter((l) => l.frequency >= 2).slice(0, maxPerRole);

  return {
    orchestrator: formatLearnings(crossRole),
    pm: byRole("pm"),
    manager: byRole("manager"),
    engineer: byRole("engineer"),
  };
}

// --- Legacy functions (deprecated, kept for backward compat) ---

/** @deprecated Use loadProcessLearnings() instead */
export function loadLearnings(): string {
  const path = learningsPath();
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/** @deprecated Use extractProcessLearnings() instead */
export function appendLearnings(
  state: SprintState,
  record: SprintRecord,
  retro: string
): void {
  ensureStorageDir();

  const completed = state.tasks.filter((t) => t.status === "completed");
  const incomplete = state.tasks.filter(
    (t) => t.status !== "completed" && t.status !== "deleted"
  );
  const escalations = state.messages.filter(
    (m) => m.protocol === "ESCALATION"
  );

  const lines: string[] = [
    "",
    `## Sprint ${record.sprintId}`,
    `_${record.completedAt}_`,
    "",
    `**Completion:** ${record.completedTasks}/${record.totalTasks} tasks | **Avg review rounds:** ${record.avgReviewRoundsPerTask}`,
    "",
  ];

  if (completed.length > 0) {
    lines.push("### Completed");
    for (const t of completed) lines.push(`- ${t.subject}`);
    lines.push("");
  }

  if (incomplete.length > 0) {
    lines.push("### Incomplete");
    for (const t of incomplete) lines.push(`- ${t.subject} (${t.status})`);
    lines.push("");
  }

  if (escalations.length > 0) {
    lines.push("### Escalations");
    for (const m of escalations) lines.push(`- ${m.from}: ${m.content}`);
    lines.push("");
  }

  const path = learningsPath();
  if (!existsSync(path)) {
    writeFileSync(path, `# Sprint Learnings\n${lines.join("\n")}`, "utf-8");
  } else {
    appendFileSync(path, lines.join("\n"), "utf-8");
  }
}

/** @deprecated Use getRoleLearnings() instead */
export function getRecentLearnings(count: number = 3): string {
  const content = loadLearnings();
  if (!content) return "";

  const sections = content.split(/(?=^## Sprint )/m);
  const sprintSections = sections.filter((s) => s.startsWith("## Sprint "));
  if (sprintSections.length === 0) return "";

  return sprintSections.slice(-count).join("\n").trim();
}
