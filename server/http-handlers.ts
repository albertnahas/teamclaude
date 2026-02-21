import { readFile, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { historyDir, generateSprintId } from "./storage.js";
import { state, broadcast, resetState, detectProjectName } from "./state.js";
import { loadPersistedState } from "./persistence.js";
import { compileSprintPrompt, loadCustomRoles } from "./prompt.js";
import { recordSprintCompletion, loadSprintHistory, saveSprintSnapshot, saveRetroToHistory, saveRecordToHistory } from "./analytics.js";
import { createSprintBranch, generatePRSummary, getCurrentBranch } from "./git.js";
import { getRoleLearnings, extractProcessLearnings, loadProcessLearnings, saveAndRemoveLearning } from "./learnings.js";
import { analyzeSprintTasks, buildExecutionPlan, inferDependencies, applyInferredDependencies } from "./planner.js";
import { routeTaskToModel, loadModelOverrides } from "./model-router.js";
import { generateRetro, parseRetro } from "./retro.js";
import { diffRetros } from "./retro-diff.js";
import { generateVelocitySvg } from "./velocity.js";
import { createGist } from "./gist.js";
import { loadTemplates } from "./templates.js";
import * as tmux from "./tmux.js";
import { notifyWebhook } from "./notifications.js";
import { fireOnSprintStart, fireOnSprintStop } from "./plugin-loader.js";
import { loadGitHubConfig, postRetroToPR, postSprintStatusToPR } from "./github.js";
import { loadMemories, saveMemory, deleteMemory, searchMemories } from "./memory.js";
import { sprintCtx, launchViaTmux, launchViaSpawn, stopPanePolling, reconnectTmuxSession } from "./sprint-lifecycle.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function serveUI(_req: IncomingMessage, res: ServerResponse) {
  const uiDir = import.meta.dirname ?? pathDirname(fileURLToPath(import.meta.url));
  readFile(join(uiDir, "ui.html"), "utf-8", (err, html) => {
    if (err) {
      res.writeHead(500);
      res.end("Failed to load UI");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

function handleLaunch(req: IncomingMessage, res: ServerResponse) {
  if (sprintCtx.sprintProcess || state.tmuxSessionName) {
    res.writeHead(409, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: "Sprint already running" }));
    return;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));
  req.on("end", () => {
    try {
      const { roadmap, engineers = 1, includePM = false, cycles = 1 } = JSON.parse(body);

      if (!includePM && !roadmap?.trim()) {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "Roadmap required in manual mode" }));
        return;
      }

      const roleLearnings = getRoleLearnings(5);
      const customRoles = loadCustomRoles(process.cwd()) ?? undefined;
      const prompt = compileSprintPrompt(roadmap || "", engineers, includePM, cycles, roleLearnings, customRoles);
      const startedAt = Date.now();

      // Generate sprint ID once on launch so recording and history use the same ID
      sprintCtx.currentSprintId = generateSprintId();
      sprintCtx.onSprintStart?.(sprintCtx.currentSprintId);
      fireOnSprintStart(state);

      createSprintBranch(state.teamName ?? "sprint", state.cycle, process.cwd()).then((branch) => {
        sprintCtx.sprintBranch = branch;
        if (branch) console.log(`[git] Sprint branch: ${branch}`);
      });

      if (state.tmuxAvailable) {
        const sessionName = `tc-${Date.now()}`;
        launchViaTmux(prompt, sessionName, startedAt, (pid, isTmux) => {
          res.writeHead(200, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ pid, startedAt, tmux: isTmux }));
        }).catch((err: Error) => {
          console.error("[tmux] Failed to launch via tmux:", err.message);
          launchViaSpawn(prompt, roadmap, engineers, includePM, startedAt, (pid, at) => {
            res.writeHead(200, { "Content-Type": "application/json", ...CORS });
            res.end(JSON.stringify({ pid, startedAt: at }));
          });
        });
        return;
      }

      launchViaSpawn(prompt, roadmap, engineers, includePM, startedAt, (pid, at) => {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ pid, startedAt: at }));
      });
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function handleStop(res: ServerResponse) {
  const wasRunning = !!sprintCtx.sprintProcess || !!state.tmuxSessionName || !!state.teamName;
  const startedAt = sprintCtx.sprintProcess?.startedAt ?? Date.now();

  if (sprintCtx.sprintProcess) {
    sprintCtx.sprintProcess.process.kill("SIGTERM");
    sprintCtx.sprintProcess = null;
  }
  if (state.tmuxSessionName) {
    tmux.killSession(state.tmuxSessionName).catch(() => {});
    stopPanePolling();
    tmux.reset();
  }

  let record: ReturnType<typeof recordSprintCompletion> | null = null;
  if (wasRunning) {
    record = recordSprintCompletion(state, startedAt);
    notifyWebhook("sprint_complete", {
      teamName: state.teamName ?? "",
      tasksCompleted: state.tasks.filter((t) => t.status === "completed").length,
      totalTasks: state.tasks.length,
      duration: Date.now() - startedAt,
    });
  }

  const stateCopy = { ...state, tasks: [...state.tasks], messages: [...state.messages], agents: [...state.agents] };
  fireOnSprintStop(stateCopy);
  sprintCtx.lastRetro = generateRetro(stateCopy, loadSprintHistory());

  if (record) {
    const sprintId = sprintCtx.currentSprintId ?? generateSprintId();
    saveSprintSnapshot(sprintId, stateCopy);
    saveRetroToHistory(sprintId, sprintCtx.lastRetro);
    saveRecordToHistory(sprintId, record);
    extractProcessLearnings(stateCopy, record, sprintId);
    sprintCtx.onSprintStop?.();
    sprintCtx.currentSprintId = null;
  }

  // Post retro and status to GitHub PR (fire-and-forget)
  const ghConfig = loadGitHubConfig(process.cwd());
  if (ghConfig && sprintCtx.lastRetro) {
    postRetroToPR(sprintCtx.lastRetro, ghConfig).catch(() => {});
    postSprintStatusToPR(stateCopy, ghConfig).catch(() => {});
  }

  const branchAtStop = sprintCtx.sprintBranch;
  sprintCtx.sprintBranch = null;
  const tmuxWasAvailable = state.tmuxAvailable;
  resetState();
  state.projectName = detectProjectName();
  state.tmuxAvailable = tmuxWasAvailable;
  broadcast({ type: "init", state });

  generatePRSummary(stateCopy, process.cwd()).catch(() => "").then((prSummary) => {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true, prSummary, retro: sprintCtx.lastRetro, branch: branchAtStop }));
  });
}

export function handleRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = req.url ?? "";

  if (url === "/" || url === "/index.html") {
    serveUI(req, res);
  } else if (url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(state));
  } else if (url === "/api/process-status") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({
      running: !!sprintCtx.sprintProcess || !!state.tmuxSessionName,
      pid: sprintCtx.sprintProcess?.pid ?? null,
      startedAt: sprintCtx.sprintProcess?.startedAt ?? null,
      tmux: !!state.tmuxSessionName,
    }));
  } else if (url === "/api/launch" && req.method === "POST") {
    handleLaunch(req, res);
  } else if (url === "/api/stop" && req.method === "POST") {
    handleStop(res);
  } else if (url.startsWith("/api/retro/diff") && req.method === "GET") {
    const parsed = new URL(url, "http://localhost");
    const idA = parsed.searchParams.get("a");
    const idB = parsed.searchParams.get("b");
    if (!idA || !idB) {
      res.writeHead(400, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: "Query params 'a' and 'b' are required" }));
    } else {
      diffRetros(idA, idB).then((diff) => {
        if (!diff) {
          res.writeHead(404, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ error: "One or both sprint IDs not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify(diff));
        }
      }).catch(() => {
        res.writeHead(500, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "Failed to compute diff" }));
      });
    }
  } else if (url.startsWith("/api/retro") && url !== "/api/retro/gist" && req.method === "GET") {
    if (!sprintCtx.lastRetro) {
      res.writeHead(404, { "Content-Type": "text/plain", ...CORS });
      res.end("No retrospective available yet");
    } else {
      const fmt = new URL(url, "http://localhost").searchParams.get("format");
      if (fmt === "json") {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify(parseRetro(sprintCtx.lastRetro)));
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...CORS });
        res.end(sprintCtx.lastRetro);
      }
    }
  } else if (url === "/api/retro/gist" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", async () => {
      let retroContent = sprintCtx.lastRetro;
      if (!retroContent && body) {
        try {
          const { sprintId } = JSON.parse(body) as { sprintId?: string };
          if (sprintId) {
            const { readFile: readFileAsync } = await import("node:fs/promises");
            retroContent = await readFileAsync(join(historyDir(), sprintId, "retro.md"), "utf-8").catch(() => null);
          }
        } catch {}
      }
      if (!retroContent) {
        res.writeHead(404, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "No retrospective available" }));
        return;
      }
      try {
        const gistUrl = await createGist(retroContent, "sprint-retro.md");
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ url: gistUrl }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: err.message ?? "Failed to create gist" }));
      }
    });
  } else if (url.startsWith("/api/velocity.svg") && req.method === "GET") {
    const parsed = new URL(url, "http://localhost");
    const w = parseInt(parsed.searchParams.get("w") ?? "600", 10);
    const h = parseInt(parsed.searchParams.get("h") ?? "200", 10);
    const width = isNaN(w) || w < 100 ? 600 : Math.min(w, 2000);
    const height = isNaN(h) || h < 60 ? 200 : Math.min(h, 1000);
    const svg = generateVelocitySvg(loadSprintHistory(), { width, height });
    res.writeHead(200, { "Content-Type": "image/svg+xml", ...CORS });
    res.end(svg);
  } else if (url === "/api/plan" && req.method === "GET") {
    const inferred = inferDependencies(state.tasks);
    const tasksWithDeps = applyInferredDependencies(state.tasks, inferred);
    const overrides = loadModelOverrides(join(process.cwd(), ".sprint.yml"));
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({
      sprintPlan: analyzeSprintTasks(tasksWithDeps),
      executionPlan: buildExecutionPlan(tasksWithDeps),
      modelRouting: Object.fromEntries(tasksWithDeps.map((t) => [t.id, routeTaskToModel(t, overrides)])),
    }));
  } else if (url === "/api/plan/approve" && req.method === "POST") {
    res.writeHead(501, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: "Not implemented" }));
  } else if (url === "/api/task-models" && req.method === "GET") {
    const overrides = loadModelOverrides(join(process.cwd(), ".sprint.yml"));
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(Object.fromEntries(state.tasks.map((t) => [t.id, routeTaskToModel(t, overrides)]))));
  } else if (url === "/api/git-status" && req.method === "GET") {
    getCurrentBranch(process.cwd()).then((branch) => {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ branch, hasBranch: !!sprintCtx.sprintBranch }));
    });
  } else if (url.startsWith("/api/analytics") && req.method === "GET") {
    const parsed = new URL(url, "http://localhost");
    let records = loadSprintHistory();
    const cycleParam = parsed.searchParams.get("cycle");
    if (cycleParam !== null) {
      const cycle = parseInt(cycleParam, 10);
      if (!isNaN(cycle)) records = records.filter((r) => r.cycle === cycle);
    }
    const limitParam = parsed.searchParams.get("limit");
    if (limitParam !== null) {
      const limit = parseInt(limitParam, 10);
      if (!isNaN(limit) && limit > 0) records = records.slice(-limit);
    }
    if (parsed.searchParams.get("format") === "csv") {
      const header = "sprintId,completedAt,cycle,completedTasks,totalTasks,completionRate,avgReviewRoundsPerTask,totalMessages,durationSeconds";
      const rows = records.map((r) => {
        const completionRate = r.totalTasks > 0 ? Math.round((r.completedTasks / r.totalTasks) * 100) : 0;
        const startedMs = r.startedAt ? new Date(r.startedAt).getTime() : 0;
        const completedMs = r.completedAt ? new Date(r.completedAt).getTime() : 0;
        const durationSeconds = startedMs && completedMs ? Math.round((completedMs - startedMs) / 1000) : 0;
        return [r.sprintId, r.completedAt, r.cycle, r.completedTasks, r.totalTasks, completionRate, r.avgReviewRoundsPerTask, r.totalMessages, durationSeconds].join(",");
      });
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=\"teamclaude-history.csv\"",
        ...CORS,
      });
      res.end([header, ...rows].join("\n"));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(records));
  } else if (url === "/api/pause" && req.method === "POST") {
    state.paused = !state.paused;
    console.log(`[sprint] ${state.paused ? "Paused" : "Resumed"}`);
    broadcast({ type: "paused", paused: state.paused });
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ paused: state.paused }));
  } else if (url === "/api/dismiss-escalation" && req.method === "POST") {
    state.escalation = null;
    broadcast({ type: "escalation", escalation: null });
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true }));
  } else if (url === "/api/dismiss-merge-conflict" && req.method === "POST") {
    state.mergeConflict = null;
    broadcast({ type: "merge_conflict", mergeConflict: null });
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true }));
  } else if (url === "/api/checkpoint" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      try {
        const { taskId } = JSON.parse(body) as { taskId: string };
        if (taskId && !state.checkpoints.includes(taskId)) {
          state.checkpoints.push(taskId);
        }
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "Invalid body" }));
      }
    });
  } else if (url === "/api/checkpoint/release" && req.method === "POST") {
    state.pendingCheckpoint = null;
    broadcast({ type: "checkpoint", checkpoint: null });
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true }));
  } else if (url === "/api/templates" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(loadTemplates()));
  } else if (url.startsWith("/api/history") && !url.startsWith("/api/history/") && req.method === "GET") {
    try {
      const parsedHistoryUrl = new URL(url, "http://localhost");
      const dir = historyDir();
      const entries = existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith("sprint-"))
            .map((d) => {
              const recordPath = join(dir, d.name, "record.json");
              let record = null;
              if (existsSync(recordPath)) {
                try { record = JSON.parse(readFileSync(recordPath, "utf-8")); } catch {}
              }
              return { id: d.name, record };
            })
            .sort((a, b) => a.id.localeCompare(b.id))
        : [];
      if (parsedHistoryUrl.searchParams.get("format") === "csv") {
        const header = "id,teamName,tasksCompleted,totalTasks,durationMs,startedAt,completedAt";
        const rows = entries.map(({ id, record: r }) => {
          const teamName = r?.sprintId?.replace(/-\d+$/, "") ?? id;
          const startMs = r?.startedAt ? new Date(r.startedAt).getTime() : 0;
          const endMs = r?.completedAt ? new Date(r.completedAt).getTime() : 0;
          const durationMs = startMs && endMs ? endMs - startMs : 0;
          return [id, teamName, r?.completedTasks ?? 0, r?.totalTasks ?? 0, durationMs, r?.startedAt ?? "", r?.completedAt ?? ""].join(",");
        });
        res.writeHead(200, {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=\"sprint-history.csv\"",
          ...CORS,
        });
        res.end([header, ...rows].join("\n"));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify(entries));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end("[]");
    }
  } else if (url.startsWith("/api/history/") && url.includes("/retro") && req.method === "GET") {
    const parsedUrl = new URL(url, "http://localhost");
    const pathParts = parsedUrl.pathname.slice("/api/history/".length);
    const id = pathParts.slice(0, pathParts.lastIndexOf("/retro"));
    const retroPath = join(historyDir(), id, "retro.md");
    if (existsSync(retroPath)) {
      const retroContent = readFileSync(retroPath, "utf-8");
      const fmt = parsedUrl.searchParams.get("format");
      if (fmt === "json") {
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify(parseRetro(retroContent)));
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...CORS });
        res.end(retroContent);
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain", ...CORS });
      res.end("Not found");
    }
  } else if (url === "/api/process-learnings" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(loadProcessLearnings()));
  } else if (url.startsWith("/api/process-learnings/") && req.method === "DELETE") {
    const id = decodeURIComponent(url.slice("/api/process-learnings/".length));
    const removed = saveAndRemoveLearning(id);
    if (!removed) {
      res.writeHead(404, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: "Not found" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ ok: true }));
    }
  } else if (url === "/api/resume" && req.method === "POST") {
    if (state.teamName) {
      res.writeHead(409, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: "Sprint already active" }));
      return;
    }
    const saved = loadPersistedState();
    if (!saved?.teamName) {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ resumed: false }));
      return;
    }
    const { tmuxAvailable: _, tmuxSessionName: __, projectName: ___, ...resumable } = saved;
    Object.assign(state, resumable);
    broadcast({ type: "init", state });
    console.log(`[sprint] Resumed via API: team=${state.teamName}, tasks=${state.tasks.length}`);
    reconnectTmuxSession();
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ resumed: true, teamName: state.teamName }));
  } else if (url.startsWith("/api/memories") && req.method === "GET") {
    const parsed = new URL(url, "http://localhost");
    const role = parsed.searchParams.get("role");
    const query = parsed.searchParams.get("q");
    const cwd = process.cwd();
    const memories = query
      ? searchMemories(cwd, query)
      : role
        ? loadMemories(cwd).filter((m) => m.role === role)
        : loadMemories(cwd);
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(memories));
  } else if (url.startsWith("/api/memories/") && req.method === "DELETE") {
    const id = decodeURIComponent(url.slice("/api/memories/".length));
    const removed = deleteMemory(process.cwd(), id);
    if (!removed) {
      res.writeHead(404, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: "Not found" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ ok: true }));
    }
  } else if (url === "/api/memories" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      try {
        const { role, key, value } = JSON.parse(body) as { role: string; key: string; value: string };
        if (!role || !key || !value) {
          res.writeHead(400, { "Content-Type": "application/json", ...CORS });
          res.end(JSON.stringify({ error: "role, key, and value are required" }));
          return;
        }
        const memory = saveMemory(process.cwd(), role, key, value, null);
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify(memory));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "Invalid body" }));
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}
