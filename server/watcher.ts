import { basename } from "node:path";
import { statSync } from "node:fs";
import { watch } from "chokidar";
import {
  state,
  inboxCursors,
  taskProtocolOverrides,
  safeReadJSON,
  broadcast,
} from "./state.js";
import { detectProtocol, extractContent } from "./protocol.js";
import type { Message } from "./state.js";
import { runVerification } from "./verification.js";
import { notifyWebhook } from "./notifications.js";
import { fireOnTaskComplete, fireOnEscalation } from "./plugin-loader.js";
import { accumulateTokenUsage } from "./token-tracker.js";
import { handleTaskFile } from "./task-state.js";
import { ensureAgent, handleTeamConfig } from "./team-config.js";
import { saveMemory } from "./memory.js";

// Re-export symbols that watcher.test.ts imports
export { isSprintTeam, setTeamDiscoveredHook, handleTeamConfig } from "./team-config.js";
export { handleTaskFile } from "./task-state.js";

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

    // Auto-discover agents from inbox traffic
    ensureAgent(to);
    ensureAgent(from);

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
        let inferredStatus: import("./state.js").TaskInfo["status"] | null = null;
        let inferredOwner: string | null = null;

        switch (message.protocol) {
          case "TASK_ASSIGNED":
            inferredStatus = "in_progress";
            inferredOwner = message.to;
            break;
          case "READY_FOR_REVIEW":
            if (state.reviewTaskIds.includes(tid)) break; // dedup — already in review
            inferredStatus = "in_progress";
            state.reviewTaskIds.push(tid);
            // Checkpoint gate: pause sprint for human review before manager acts
            if (state.checkpoints.includes(tid)) {
              state.checkpoints = state.checkpoints.filter((id) => id !== tid);
              const taskSubject =
                state.tasks.find((t) => t.id === tid)?.subject ?? `Task #${tid}`;
              state.pendingCheckpoint = { taskId: tid, taskSubject };
              broadcast({ type: "checkpoint", checkpoint: state.pendingCheckpoint });
              notifyWebhook("checkpoint_hit", { taskId: tid, subject: taskSubject });
            }
            break;
          case "APPROVED": {
            state.reviewTaskIds = state.reviewTaskIds.filter(
              (id) => id !== tid
            );
            if (!state.validatingTaskIds.includes(tid))
              state.validatingTaskIds.push(tid);
            inferredStatus = "in_progress"; // stays in_progress while validating
            triggerTaskValidation(tid);
            break;
          }
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
      const escalatedTaskId = taskMatch?.[1] || "?";
      state.escalation = {
        taskId: escalatedTaskId,
        reason,
        from: from,
        timestamp: ts,
      };
      broadcast({ type: "escalation", escalation: state.escalation });
      notifyWebhook("task_escalated", {
        taskId: escalatedTaskId,
        reason,
        from,
      });
      fireOnEscalation(state.escalation, state);
    }

    if (message.protocol === "MEMORY") {
      // Format: MEMORY: <key> — <value>
      const body = content.replace(/^MEMORY:\s*/, "");
      const sepIdx = body.indexOf(" — ");
      if (sepIdx > 0) {
        const key = body.slice(0, sepIdx).trim();
        const value = body.slice(sepIdx + 3).trim();
        if (key && value) {
          // Infer role from agent name
          const agentName = from.toLowerCase();
          const role = agentName.includes("pm") ? "pm"
            : agentName.includes("manager") ? "manager"
            : agentName.includes("qa") ? "qa"
            : agentName.includes("tech-writer") ? "tech-writer"
            : "engineer";
          try {
            saveMemory(process.cwd(), role, key, value, state.teamName);
          } catch (err: any) {
            console.error("[memory] Failed to save memory:", err.message);
          }
        }
      }
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
        notifyWebhook("sprint_complete", {
          teamName: state.teamName ?? "",
          tasksCompleted: state.tasks.filter((t) => t.status === "completed").length,
          totalTasks: state.tasks.length,
        });
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

// --- Per-task validation gate ---

function triggerTaskValidation(taskId: string) {
  runVerification(process.cwd()).then((result) => {
    state.validatingTaskIds = state.validatingTaskIds.filter((id) => id !== taskId);
    const passed = result.passed || result.results.length === 0;
    const output = result.results.map((r) => `${r.name}: ${r.passed ? "pass" : "FAIL"}`).join(", ");
    broadcast({ type: "task_validation", taskId, passed, output });

    if (passed) {
      const task = state.tasks.find((t) => t.id === taskId);
      taskProtocolOverrides.set(taskId, {
        status: "completed",
        owner: taskProtocolOverrides.get(taskId)?.owner || task?.owner || "",
      });
      if (task) { task.status = "completed"; broadcast({ type: "task_updated", task }); }
      notifyWebhook("task_completed", { taskId, subject: task?.subject ?? "", owner: task?.owner ?? "" });
      if (task) fireOnTaskComplete(task, state);
    } else {
      const sysMsg: Message = {
        id: `sys-val-${Date.now()}`, timestamp: Date.now(), from: "system", to: "all",
        content: `Task #${taskId} approval REVERTED — verification failed (${output}). Task remains in_progress.`,
      };
      state.messages.push(sysMsg);
      broadcast({ type: "message_sent", message: sysMsg });
    }
  }).catch(() => {
    // Fail-open on infra errors — complete the task
    state.validatingTaskIds = state.validatingTaskIds.filter((id) => id !== taskId);
    const task = state.tasks.find((t) => t.id === taskId);
    taskProtocolOverrides.set(taskId, { status: "completed", owner: task?.owner || "" });
    if (task) { task.status = "completed"; broadcast({ type: "task_updated", task }); }
    if (task) fireOnTaskComplete(task, state);
  });
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
let watcherReady = false;

export function isStale(filePath: string): boolean {
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
