import { basename, dirname, join } from "node:path";
import { statSync, readFileSync, existsSync } from "node:fs";
import { watch } from "chokidar";
import {
  state,
  inboxCursors,
  taskProtocolOverrides,
  teamInitMessageSent,
  setTeamInitMessageSent,
  safeReadJSON,
  broadcast,
} from "./state.js";
import { detectProtocol, extractContent } from "./protocol.js";
import type { Message, TaskInfo } from "./state.js";
import { runVerification } from "./verification.js";

export function isSprintTeam(config: any): boolean {
  if (!config?.members) return false;
  // Accept by team name prefix (persists after agent shutdown)
  if (typeof config.name === "string" && config.name.startsWith("sprint-")) return true;
  // Accept by member names (active sprint detection)
  const names: string[] = config.members.map((m: any) => m.name);
  return (
    names.includes("sprint-manager") &&
    names.some(
      (n) => n === "sprint-engineer" || /^sprint-engineer-\d+$/.test(n)
    )
  );
}

let onTeamDiscovered: ((agents: string[]) => void) | null = null;
export function setTeamDiscoveredHook(fn: (agents: string[]) => void) {
  onTeamDiscovered = fn;
}

export function handleTeamConfig(filePath: string) {
  const config = safeReadJSON(filePath) as any;
  if (!config || !isSprintTeam(config)) return;

  const teamDir = dirname(filePath);
  const teamName = basename(teamDir);
  state.teamName = teamName;

  state.agents = (config.members || []).map((m: any) => ({
    name: m.name,
    agentId: m.agentId,
    agentType: m.agentType || "unknown",
    status: "active" as const,
  }));

  state.mode = state.agents.some((a) => a.name === "sprint-pm")
    ? "autonomous"
    : "manual";
  state.cycle = 0;
  state.phase = state.mode === "autonomous" ? "analyzing" : "sprinting";

  console.log(
    `[sprint] Tracking team: ${teamName} (${state.agents.length} agents, ${state.mode} mode)`
  );
  broadcast({ type: "init", state });

  onTeamDiscovered?.(state.agents.map((a) => a.name));

  if (!teamInitMessageSent) {
    setTeamInitMessageSent(true);
    const sysContent =
      state.mode === "autonomous"
        ? "Sprint initialized — PM is analyzing the codebase and preparing the roadmap"
        : "Sprint initialized — parsing roadmap and delegating tasks";
    const sysMsg: Message = {
      id: `sys-${Date.now()}`,
      timestamp: Date.now(),
      from: "system",
      to: "all",
      content: sysContent,
    };
    state.messages.push(sysMsg);
    broadcast({ type: "message_sent", message: sysMsg });
  }
}

// Pricing per million tokens by model family
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  haiku:  { input: 0.80, output: 4 },
  sonnet: { input: 3,    output: 15 },
  opus:   { input: 15,   output: 75 },
};

function resolveModelPricing(): { input: number; output: number } {
  const sprintYml = join(process.cwd(), ".sprint.yml");
  if (existsSync(sprintYml)) {
    try {
      const raw = readFileSync(sprintYml, "utf-8");
      const m = raw.match(/^agents:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+model:\s*(\S+)/m);
      if (m) {
        const model = m[1].toLowerCase();
        for (const key of Object.keys(MODEL_PRICING)) {
          if (model.includes(key)) return MODEL_PRICING[key];
        }
      }
    } catch {}
  }
  return MODEL_PRICING.sonnet;
}

const { input: INPUT_COST_PER_MTOK, output: OUTPUT_COST_PER_MTOK } = resolveModelPricing();

function accumulateTokenUsage(
  agentName: string,
  inputTokens: number,
  outputTokens: number
) {
  const tokens = inputTokens + outputTokens;
  state.tokenUsage.total += tokens;
  state.tokenUsage.byAgent[agentName] =
    (state.tokenUsage.byAgent[agentName] || 0) + tokens;
  state.tokenUsage.estimatedCostUsd +=
    (inputTokens * INPUT_COST_PER_MTOK + outputTokens * OUTPUT_COST_PER_MTOK) /
    1_000_000;
  broadcast({ type: "token_usage", usage: state.tokenUsage });
}

export function handleInboxMessage(filePath: string) {
  if (!state.teamName || !filePath.includes(state.teamName)) return;

  const raw = safeReadJSON(filePath) as Record<string, unknown> | Record<string, unknown>[] | null;
  if (!raw) return;

  const messages = Array.isArray(raw) ? raw : [raw];
  const recipientName = basename(filePath, ".json");
  const cursorKey = filePath;
  const cursor = inboxCursors.get(cursorKey) || 0;

  for (let i = cursor; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    const from = typeof msg?.from === "string" ? msg.from : "unknown";
    const to = recipientName;

    // Accumulate token usage if present (Claude API response format)
    const usage = msg?.usage as Record<string, unknown> | undefined;
    if (
      usage &&
      typeof usage.input_tokens === "number" &&
      typeof usage.output_tokens === "number"
    ) {
      accumulateTokenUsage(to, usage.input_tokens, usage.output_tokens);
    }

    const content = extractContent(
      (msg?.text as string) || (msg?.content as string) || JSON.stringify(msg)
    );

    if (content.startsWith("[idle:")) {
      const agent = state.agents.find((a) => a.name === recipientName);
      if (agent) {
        agent.status = "idle";
        broadcast({ type: "agent_status", agent });
      }
      continue;
    }

    const agent = state.agents.find((a) => a.name === from);
    if (agent && agent.status !== "active") {
      agent.status = "active";
      broadcast({ type: "agent_status", agent });
    }

    const ts = msg?.timestamp ? new Date(msg.timestamp as string | number).getTime() : Date.now();

    const message: Message = {
      id: `${ts}-${i}`,
      timestamp: ts,
      from,
      to,
      content,
      protocol: detectProtocol(content),
    };

    state.messages.push(message);
    broadcast({ type: "message_sent", message });

    if (message.protocol) {
      const taskMatch = content.match(/^[A-Z_]+:\s*#?(\d+)/);
      if (taskMatch) {
        const tid = taskMatch[1];
        let inferredStatus: TaskInfo["status"] | null = null;
        let inferredOwner: string | null = null;

        switch (message.protocol) {
          case "TASK_ASSIGNED":
            inferredStatus = "in_progress";
            inferredOwner = message.to;
            break;
          case "READY_FOR_REVIEW":
            inferredStatus = "in_progress";
            if (!state.reviewTaskIds.includes(tid))
              state.reviewTaskIds.push(tid);
            // Checkpoint gate: pause sprint for human review before manager acts
            if (state.checkpoints.includes(tid)) {
              state.checkpoints = state.checkpoints.filter((id) => id !== tid);
              const taskSubject =
                state.tasks.find((t) => t.id === tid)?.subject ?? `Task #${tid}`;
              state.pendingCheckpoint = { taskId: tid, taskSubject };
              broadcast({ type: "checkpoint", checkpoint: state.pendingCheckpoint });
            }
            break;
          case "APPROVED":
            inferredStatus = "completed";
            state.reviewTaskIds = state.reviewTaskIds.filter(
              (id) => id !== tid
            );
            break;
          case "REQUEST_CHANGES":
          case "RESUBMIT":
            inferredStatus = "in_progress";
            state.reviewTaskIds = state.reviewTaskIds.filter(
              (id) => id !== tid
            );
            break;
        }

        if (inferredStatus) {
          const prev = taskProtocolOverrides.get(tid);
          taskProtocolOverrides.set(tid, {
            status: inferredStatus,
            owner: inferredOwner || prev?.owner || "",
          });

          const task = state.tasks.find((t) => t.id === tid);
          if (task) {
            task.status = inferredStatus;
            if (inferredOwner) task.owner = inferredOwner;
            broadcast({ type: "task_updated", task });
          }
        }
      }
    }

    if (message.protocol === "ESCALATE") {
      const reason = content.replace(/^ESCALATE:\s*/, "");
      const taskMatch = reason.match(/^(\d+)/);
      state.escalation = {
        taskId: taskMatch?.[1] || "?",
        reason,
        from: from,
        timestamp: ts,
      };
      broadcast({ type: "escalation", escalation: state.escalation });
    }

    if (state.mode === "autonomous" && message.protocol) {
      let phaseChanged = false;
      if (message.protocol === "NEXT_CYCLE") {
        const m = content.match(/NEXT_CYCLE:\s*(\d+)/);
        state.cycle = m ? parseInt(m[1], 10) : state.cycle + 1;
        state.phase = "analyzing";
        phaseChanged = true;
      } else if (message.protocol === "ROADMAP_READY") {
        const m = content.match(/cycle\s+(\d+)/);
        if (m) state.cycle = parseInt(m[1], 10);
        state.phase = "sprinting";
        phaseChanged = true;
      } else if (message.protocol === "CYCLE_COMPLETE") {
        state.phase = "validating";
        phaseChanged = true;
        triggerValidation();
      } else if (message.protocol === "SPRINT_COMPLETE") {
        state.phase = "validating";
        phaseChanged = true;
        triggerValidation();
      } else if (message.protocol === "ACCEPTANCE") {
        state.phase = "analyzing";
        phaseChanged = true;
      }
      if (phaseChanged) {
        broadcast({
          type: "cycle_info",
          cycle: state.cycle,
          phase: state.phase,
          mode: state.mode,
        });
        const phaseLabels: Record<string, string> = {
          analyzing:
            "PM is re-analyzing the codebase for the next cycle",
          sprinting:
            "Roadmap ready — Manager is delegating tasks to engineers",
          validating: "Sprint execution complete — reviewing results",
        };
        const phaseLabel = phaseLabels[state.phase];
        if (phaseLabel) {
          const sysMsg: Message = {
            id: `sys-phase-${Date.now()}`,
            timestamp: Date.now(),
            from: "system",
            to: "all",
            content: phaseLabel,
          };
          state.messages.push(sysMsg);
          broadcast({ type: "message_sent", message: sysMsg });
        }
      }
    }
  }

  inboxCursors.set(cursorKey, messages.length);
}

export function handleTaskFile(filePath: string) {
  if (!state.teamName || !filePath.includes(state.teamName)) return;

  const raw = safeReadJSON(filePath) as any;
  if (!raw) return;

  const tasks = Array.isArray(raw) ? raw : [raw];

  for (const t of tasks) {
    if (!t.id) continue;

    const subj = t.subject || t.title || "";
    if (
      subj === "sprint-manager" ||
      subj === "sprint-pm" ||
      subj === "sprint-engineer" ||
      /^sprint-engineer-\d+$/.test(subj)
    )
      continue;

    const task: TaskInfo = {
      id: String(t.id),
      subject: t.subject || t.title || "Untitled",
      status: t.status || "pending",
      owner: t.owner || "",
      blockedBy: t.blockedBy || [],
      description: t.description,
    };

    const override = taskProtocolOverrides.get(task.id);
    if (override) {
      const rank = {
        pending: 0,
        in_progress: 1,
        completed: 2,
        deleted: 3,
      } as const;
      if ((rank[override.status] ?? 0) > (rank[task.status] ?? 0))
        task.status = override.status;
      if (override.owner && !task.owner) task.owner = override.owner;
    }

    const existing = state.tasks.findIndex((x) => x.id === task.id);
    if (existing >= 0) {
      state.tasks[existing] = task;
    } else {
      state.tasks.push(task);
    }

    if (task.status === "completed") {
      state.reviewTaskIds = state.reviewTaskIds.filter(
        (id) => id !== task.id
      );
      // Unblock tasks that depended on this one
      for (const t of state.tasks) {
        if (t.blockedBy.includes(task.id)) {
          t.blockedBy = t.blockedBy.filter((id) => id !== task.id);
          broadcast({ type: "task_updated", task: t });
        }
      }
    }

    broadcast({ type: "task_updated", task });
  }
}

// --- Validation gate ---

function triggerValidation() {
  const cwd = process.cwd();
  runVerification(cwd).then((result) => {
    broadcast({ type: "validation", validation: result });
    const statusLabel = result.passed ? "passed" : "FAILED";
    const details = result.results.map((r) => `${r.name}: ${r.passed ? "pass" : "FAIL"}`).join(", ");
    const sysMsg: Message = {
      id: `sys-validation-${Date.now()}`,
      timestamp: Date.now(),
      from: "system",
      to: "all",
      content: result.results.length === 0
        ? "Validation skipped — no verification commands configured"
        : `Validation ${statusLabel}: ${details}`,
    };
    state.messages.push(sysMsg);
    broadcast({ type: "message_sent", message: sysMsg });
    if (!result.passed) {
      state.escalation = {
        taskId: "validation",
        reason: `Verification failed: ${result.results.filter((r) => !r.passed).map((r) => r.name).join(", ")}`,
        from: "system",
        timestamp: Date.now(),
      };
      broadcast({ type: "escalation", escalation: state.escalation });
    }
    console.log(`[sprint] Validation ${statusLabel}${details ? `: ${details}` : ""}`);
  }).catch((err: Error) => {
    console.error("[sprint] Validation error:", err.message);
  });
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
let watcherReady = false;

function isStale(filePath: string): boolean {
  try {
    const mtime = statSync(filePath).mtimeMs;
    return Date.now() - mtime > STALE_THRESHOLD_MS;
  } catch {
    return true;
  }
}

function handleFile(filePath: string) {
  if (!filePath.endsWith(".json")) return;

  // During initial scan, skip stale files from old sprint sessions
  if (!watcherReady && isStale(filePath)) return;

  if (filePath.includes("/teams/") && basename(filePath) === "config.json") {
    handleTeamConfig(filePath);
  } else if (filePath.includes("/inboxes/")) {
    handleInboxMessage(filePath);
  } else if (filePath.includes("/tasks/")) {
    handleTaskFile(filePath);
  }
}

export function startWatching(teamsDir: string, tasksDir: string) {
  watcherReady = false;
  const watcher = watch([teamsDir, tasksDir], {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200 },
    ignored: [/\.lock$/, /\.highwatermark$/],
  });

  watcher.on("add", handleFile).on("change", handleFile);

  watcher.on("ready", () => {
    watcherReady = true;
    console.log(`[sprint] Watching ${teamsDir} and ${tasksDir}`);
  });

  watcher.on("error", (err: unknown) => {
    console.error("[sprint] Watcher error:", err instanceof Error ? err.message : err);
  });
}
