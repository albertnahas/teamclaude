import { basename, dirname } from "node:path";
import { statSync } from "node:fs";
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

export function isSprintTeam(config: any): boolean {
  if (!config?.members) return false;
  const names: string[] = config.members.map((m: any) => m.name);
  return (
    names.includes("sprint-manager") &&
    names.some(
      (n) => n === "sprint-engineer" || /^sprint-engineer-\d+$/.test(n)
    )
  );
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
  state.phase = state.mode === "autonomous" ? "analyzing" : "idle";

  console.log(
    `[sprint] Tracking team: ${teamName} (${state.agents.length} agents, ${state.mode} mode)`
  );
  broadcast({ type: "init", state });

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

export function handleInboxMessage(filePath: string) {
  if (!state.teamName || !filePath.includes(state.teamName)) return;

  const raw = safeReadJSON(filePath) as any;
  if (!raw) return;

  const messages = Array.isArray(raw) ? raw : [raw];
  const recipientName = basename(filePath, ".json");
  const cursorKey = filePath;
  const cursor = inboxCursors.get(cursorKey) || 0;

  for (let i = cursor; i < messages.length; i++) {
    const msg = messages[i];
    const from = msg?.from || "unknown";
    const to = recipientName;
    const content = extractContent(
      msg?.text || msg?.content || JSON.stringify(msg)
    );

    if (content.startsWith("[idle:")) continue;

    const ts = msg?.timestamp ? new Date(msg.timestamp).getTime() : Date.now();

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
      } else if (message.protocol === "SPRINT_COMPLETE") {
        state.phase = "validating";
        phaseChanged = true;
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
    }

    broadcast({ type: "task_updated", task });
  }
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
