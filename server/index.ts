import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { WebSocketServer } from "ws";

import { setProjectRoot, generateSprintId, historyDir } from "./storage.js";
import { state, clients, broadcast, resetState, detectProjectName } from "./state.js";
import { loadPersistedState, flushSave } from "./persistence.js";
import { startWatching, setTeamDiscoveredHook } from "./watcher.js";
import { compileSprintPrompt } from "./prompt.js";
import { recordSprintCompletion, loadSprintHistory, saveSprintSnapshot, saveRetroToHistory, saveRecordToHistory, migrateGlobalAnalytics } from "./analytics.js";
import { createSprintBranch, generatePRSummary, getCurrentBranch } from "./git.js";
import { loadLearnings, getRecentLearnings, appendLearnings, getRoleLearnings, extractProcessLearnings, loadProcessLearnings, saveAndRemoveLearning } from "./learnings.js";
import { analyzeSprintTasks, buildExecutionPlan, inferDependencies, applyInferredDependencies } from "./planner.js";
import { routeTaskToModel, loadModelOverrides } from "./model-router.js";
import { generateRetro, parseRetro } from "./retro.js";
import { diffRetros } from "./retro-diff.js";
import { generateVelocitySvg } from "./velocity.js";
import { createGist } from "./gist.js";
import { loadTemplates } from "./templates.js";
import * as tmux from "./tmux.js";

// --- CLI flags ---

function parseArgs(): { port: number } {
  const args = process.argv.slice(2);
  let port: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (port === null) {
    const sprintYml = join(process.cwd(), ".sprint.yml");
    if (existsSync(sprintYml)) {
      try {
        const raw = readFileSync(sprintYml, "utf-8");
        const m = raw.match(/^server:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+port:\s*(\d+)/m);
        if (m) port = parseInt(m[1], 10);
      } catch {}
    }
  }

  return { port: port ?? 3456 };
}

// --- Paths ---

const CLAUDE_DIR = join(homedir(), ".claude");
const TEAMS_DIR = join(CLAUDE_DIR, "teams");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

// --- Process management ---

let sprintProcess: {
  pid: number;
  process: ChildProcess;
  startedAt: number;
  config: { roadmap: string; engineers: number; includePM: boolean };
} | null = null;

let sprintBranch: string | null = null;
let lastRetro: string | null = null;
let panePollingInterval: ReturnType<typeof setInterval> | null = null;
let tmuxSessionCheckInterval: ReturnType<typeof setInterval> | null = null;

/** Reset lastRetro — for testing only */
export function _resetLastRetro() { lastRetro = null; }

// --- HTTP handlers ---

function serveUI(_req: IncomingMessage, res: ServerResponse) {
  const uiDir = import.meta.dirname ?? pathDirname(fileURLToPath(import.meta.url));
  const uiPath = join(uiDir, "ui.html");
  readFile(uiPath, "utf-8", (err, html) => {
    if (err) {
      res.writeHead(500);
      res.end("Failed to load UI");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

function stopPanePolling() {
  if (panePollingInterval) {
    clearInterval(panePollingInterval);
    panePollingInterval = null;
  }
  if (tmuxSessionCheckInterval) {
    clearInterval(tmuxSessionCheckInterval);
    tmuxSessionCheckInterval = null;
  }
}

function startPanePolling() {
  if (panePollingInterval) return;
  const session = state.tmuxSessionName;
  if (!session) return;

  panePollingInterval = setInterval(async () => {
    const panes = await tmux.listPanes(session);
    for (const pane of panes) {
      const target = `${session}:0.${pane.index}`;
      const content = await tmux.pollPane(target);
      if (content === null) continue;

      let paneName: string | null = null;
      if (pane.index === 0) {
        paneName = "orchestrator";
      } else {
        for (const agent of state.agents) {
          if (tmux.getPaneForAgent(agent.name) === String(pane.index)) {
            paneName = agent.name;
            break;
          }
        }
      }

      broadcast({
        type: "terminal_output",
        agentName: paneName ?? `pane-${pane.index}`,
        paneIndex: pane.index,
        content,
      });
    }
  }, 300);
}

async function launchViaTmux(
  prompt: string,
  sessionName: string,
  res: ServerResponse,
  cors: Record<string, string>,
  startedAt: number
) {
  await tmux.createSession(sessionName);
  state.tmuxSessionName = sessionName;

  // Write prompt to a temp file to avoid tmux send-keys buffer limits
  const tmpDir = join(homedir(), ".claude");
  const promptFile = join(tmpDir, `sprint-prompt-${sessionName}.txt`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(promptFile, prompt, "utf-8");

  // Build a short command that reads the prompt from file
  const cmd = `unset CLAUDECODE && claude -p "$(cat ${shellEscape(promptFile)})" --permission-mode bypassPermissions; rm -f ${shellEscape(promptFile)}`;
  await tmux.sendKeys(`${sessionName}:0.0`, cmd);
  await tmux.sendSpecialKey(`${sessionName}:0.0`, "Enter");

  console.log(`[sprint] Launched claude in tmux session: ${sessionName}`);
  broadcast({ type: "process_started", pid: 0 });

  // Poll tmux has-session for exit detection
  tmuxSessionCheckInterval = setInterval(async () => {
    const alive = await tmux.hasSession(sessionName);
    if (!alive) {
      console.log(`[sprint] tmux session ${sessionName} ended`);
      stopPanePolling();
      sprintProcess = null;
      broadcast({ type: "process_exited", code: 0 });
    }
  }, 5000);

  res.writeHead(200, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify({ pid: 0, startedAt, tmux: true }));
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function handleLaunch(
  req: IncomingMessage,
  res: ServerResponse,
  cors: Record<string, string>
) {
  if (sprintProcess || state.tmuxSessionName) {
    res.writeHead(409, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "Sprint already running" }));
    return;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));
  req.on("end", () => {
    try {
      const {
        roadmap,
        engineers = 1,
        includePM = false,
        cycles = 1,
      } = JSON.parse(body);

      if (!includePM && !roadmap?.trim()) {
        res.writeHead(400, { "Content-Type": "application/json", ...cors });
        res.end(
          JSON.stringify({ error: "Roadmap required in manual mode" })
        );
        return;
      }

      const roleLearnings = getRoleLearnings(5);
      const prompt = compileSprintPrompt(
        roadmap || "",
        engineers,
        includePM,
        cycles,
        roleLearnings
      );

      const startedAt = Date.now();

      createSprintBranch(
        state.teamName ?? "sprint",
        state.cycle,
        process.cwd()
      ).then((branch) => {
        sprintBranch = branch;
        if (branch) console.log(`[git] Sprint branch: ${branch}`);
      });

      // --- Tmux path ---
      if (state.tmuxAvailable) {
        const sessionName = `tc-${Date.now()}`;
        launchViaTmux(prompt, sessionName, res, cors, startedAt).catch(
          (err) => {
            console.error("[tmux] Failed to launch via tmux:", err.message);
            // Fallback to child_process
            launchViaSpawn(prompt, roadmap, engineers, includePM, startedAt, res, cors);
          }
        );
        return;
      }

      // --- Fallback: child_process path ---
      launchViaSpawn(prompt, roadmap, engineers, includePM, startedAt, res, cors);
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function launchViaSpawn(
  prompt: string,
  roadmap: string,
  engineers: number,
  includePM: boolean,
  startedAt: number,
  res: ServerResponse,
  cors: Record<string, string>
) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const child = spawn(
    "claude",
    ["-p", prompt, "--permission-mode", "bypassPermissions"],
    { stdio: ["ignore", "pipe", "pipe"], env }
  );

  sprintProcess = {
    pid: child.pid!,
    process: child,
    startedAt,
    config: { roadmap, engineers, includePM },
  };

  console.log(`[sprint] Launched claude process (PID ${child.pid})`);
  broadcast({ type: "process_started", pid: child.pid! });

  child.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[claude] ${d}`)
  );
  child.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[claude:err] ${d}`)
  );

  child.on("exit", (code) => {
    console.log(`[sprint] Claude process exited (code ${code})`);
    sprintProcess = null;
    broadcast({ type: "process_exited", code });
  });

  const { pid } = sprintProcess;
  res.writeHead(200, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify({ pid, startedAt }));
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    serveUI(req, res);
  } else if (req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(state));
  } else if (req.url === "/api/process-status") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(
      JSON.stringify({
        running: !!sprintProcess || !!state.tmuxSessionName,
        pid: sprintProcess?.pid ?? null,
        startedAt: sprintProcess?.startedAt ?? null,
        tmux: !!state.tmuxSessionName,
      })
    );
  } else if (req.url === "/api/launch" && req.method === "POST") {
    handleLaunch(req, res, cors);
  } else if (req.url === "/api/stop" && req.method === "POST") {
    const wasRunning = !!sprintProcess || !!state.tmuxSessionName || !!state.teamName;
    const startedAt = sprintProcess?.startedAt ?? Date.now();
    if (sprintProcess) {
      sprintProcess.process.kill("SIGTERM");
      sprintProcess = null;
    }
    // Kill tmux session if active
    if (state.tmuxSessionName) {
      tmux.killSession(state.tmuxSessionName).catch(() => {});
      stopPanePolling();
      tmux.reset();
    }
    let record: ReturnType<typeof recordSprintCompletion> | null = null;
    if (wasRunning) record = recordSprintCompletion(state, startedAt);
    const stateCopy = { ...state, tasks: [...state.tasks], messages: [...state.messages], agents: [...state.agents] };
    const history = loadSprintHistory();
    lastRetro = generateRetro(stateCopy, history);

    // Save sprint history snapshot
    if (record) {
      const sprintId = generateSprintId();
      saveSprintSnapshot(sprintId, stateCopy);
      saveRetroToHistory(sprintId, lastRetro);
      saveRecordToHistory(sprintId, record);
      appendLearnings(stateCopy, record, lastRetro);
      extractProcessLearnings(stateCopy, record, sprintId);
    }

    const branchAtStop = sprintBranch;
    sprintBranch = null;
    const tmuxWasAvailable = state.tmuxAvailable;
    resetState();
    state.projectName = detectProjectName();
    state.tmuxAvailable = tmuxWasAvailable;
    broadcast({ type: "init", state });
    generatePRSummary(stateCopy, process.cwd()).catch(() => "").then((prSummary) => {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true, prSummary, retro: lastRetro, branch: branchAtStop }));
    });
  } else if (req.url?.startsWith("/api/retro/diff") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const idA = url.searchParams.get("a");
    const idB = url.searchParams.get("b");
    if (!idA || !idB) {
      res.writeHead(400, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Query params 'a' and 'b' are required" }));
    } else {
      diffRetros(idA, idB).then((diff) => {
        if (!diff) {
          res.writeHead(404, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "One or both sprint IDs not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify(diff));
        }
      }).catch(() => {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "Failed to compute diff" }));
      });
    }
  } else if (req.url?.startsWith("/api/retro") && req.url !== "/api/retro/gist" && req.method === "GET") {
    if (!lastRetro) {
      res.writeHead(404, { "Content-Type": "text/plain", ...cors });
      res.end("No retrospective available yet");
    } else {
      const fmt = new URL(req.url, "http://localhost").searchParams.get("format");
      if (fmt === "json") {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify(parseRetro(lastRetro)));
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...cors });
        res.end(lastRetro);
      }
    }
  } else if (req.url === "/api/retro/gist" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", async () => {
      let retroContent = lastRetro;

      // Allow loading a historical retro by sprintId
      if (!retroContent && body) {
        try {
          const { sprintId } = JSON.parse(body) as { sprintId?: string };
          if (sprintId) {
            const { readFile: readFileAsync } = await import("node:fs/promises");
            const retroPath = join(historyDir(), sprintId, "retro.md");
            retroContent = await readFileAsync(retroPath, "utf-8").catch(() => null);
          }
        } catch {}
      }

      if (!retroContent) {
        res.writeHead(404, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "No retrospective available" }));
        return;
      }

      try {
        const url = await createGist(retroContent, "sprint-retro.md");
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ url }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: err.message ?? "Failed to create gist" }));
      }
    });
  } else if (req.url?.startsWith("/api/velocity.svg") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const w = parseInt(url.searchParams.get("w") ?? "600", 10);
    const h = parseInt(url.searchParams.get("h") ?? "200", 10);
    const width = isNaN(w) || w < 100 ? 600 : Math.min(w, 2000);
    const height = isNaN(h) || h < 60 ? 200 : Math.min(h, 1000);
    const records = loadSprintHistory();
    const svg = generateVelocitySvg(records, { width, height });
    res.writeHead(200, { "Content-Type": "image/svg+xml", ...cors });
    res.end(svg);
  } else if (req.url === "/api/plan" && req.method === "GET") {
    const inferred = inferDependencies(state.tasks);
    const tasksWithDeps = applyInferredDependencies(state.tasks, inferred);
    const sprintPlan = analyzeSprintTasks(tasksWithDeps);
    const executionPlan = buildExecutionPlan(tasksWithDeps);
    const overrides = loadModelOverrides(join(process.cwd(), ".sprint.yml"));
    const modelRouting = Object.fromEntries(
      tasksWithDeps.map((t) => [t.id, routeTaskToModel(t, overrides)])
    );
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ sprintPlan, executionPlan, modelRouting }));
  } else if (req.url === "/api/plan/approve" && req.method === "POST") {
    // Approval is recorded as a no-op flag for now; launch is handled separately
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.url === "/api/task-models" && req.method === "GET") {
    const overrides = loadModelOverrides(join(process.cwd(), ".sprint.yml"));
    const taskModels = Object.fromEntries(
      state.tasks.map((t) => [t.id, routeTaskToModel(t, overrides)])
    );
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(taskModels));
  } else if (req.url === "/api/git-status" && req.method === "GET") {
    getCurrentBranch(process.cwd()).then((branch) => {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ branch, hasBranch: !!sprintBranch }));
    });
  } else if (req.url?.startsWith("/api/analytics") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    let records = loadSprintHistory();
    const cycleParam = url.searchParams.get("cycle");
    if (cycleParam !== null) {
      const cycle = parseInt(cycleParam, 10);
      if (!isNaN(cycle)) records = records.filter((r) => r.cycle === cycle);
    }
    const limitParam = url.searchParams.get("limit");
    if (limitParam !== null) {
      const limit = parseInt(limitParam, 10);
      if (!isNaN(limit) && limit > 0) records = records.slice(-limit);
    }
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(records));
  } else if (req.url === "/api/pause" && req.method === "POST") {
    state.paused = !state.paused;
    console.log(`[sprint] ${state.paused ? "Paused" : "Resumed"}`);
    broadcast({ type: "paused", paused: state.paused });
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ paused: state.paused }));
  } else if (
    req.url === "/api/dismiss-escalation" &&
    req.method === "POST"
  ) {
    state.escalation = null;
    broadcast({ type: "escalation", escalation: null });
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true }));
  } else if (
    req.url === "/api/dismiss-merge-conflict" &&
    req.method === "POST"
  ) {
    state.mergeConflict = null;
    broadcast({ type: "merge_conflict", mergeConflict: null });
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.url === "/api/checkpoint" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      try {
        const { taskId } = JSON.parse(body) as { taskId: string };
        if (taskId && !state.checkpoints.includes(taskId)) {
          state.checkpoints.push(taskId);
        }
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "Invalid body" }));
      }
    });
  } else if (req.url === "/api/checkpoint/release" && req.method === "POST") {
    state.pendingCheckpoint = null;
    broadcast({ type: "checkpoint", checkpoint: null });
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true }));
  } else if (req.url === "/api/templates" && req.method === "GET") {
    const templates = loadTemplates();
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(templates));
  } else if (req.url === "/api/history" && req.method === "GET") {
    try {
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
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(entries));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end("[]");
    }
  } else if (req.url?.startsWith("/api/history/") && req.url.includes("/retro") && req.method === "GET") {
    const parsedUrl = new URL(req.url, "http://localhost");
    const pathParts = parsedUrl.pathname.slice("/api/history/".length);
    const id = pathParts.slice(0, pathParts.lastIndexOf("/retro"));
    const retroPath = join(historyDir(), id, "retro.md");
    if (existsSync(retroPath)) {
      const retroContent = readFileSync(retroPath, "utf-8");
      const fmt = parsedUrl.searchParams.get("format");
      if (fmt === "json") {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify(parseRetro(retroContent)));
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...cors });
        res.end(retroContent);
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain", ...cors });
      res.end("Not found");
    }
  } else if (req.url === "/api/learnings" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...cors });
    res.end(loadLearnings());
  } else if (req.url === "/api/process-learnings" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(loadProcessLearnings()));
  } else if (req.url?.startsWith("/api/process-learnings/") && req.method === "DELETE") {
    const id = decodeURIComponent(req.url.slice("/api/process-learnings/".length));
    const removed = saveAndRemoveLearning(id);
    if (!removed) {
      res.writeHead(404, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Not found" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true }));
    }
  } else if (req.url === "/api/resume" && req.method === "POST") {
    if (state.teamName) {
      res.writeHead(409, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Sprint already active" }));
      return;
    }
    const saved = loadPersistedState();
    if (!saved?.teamName) {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ resumed: false }));
      return;
    }
    const { tmuxAvailable: _, tmuxSessionName: __, projectName: ___, ...resumable } = saved;
    Object.assign(state, resumable);
    broadcast({ type: "init", state });
    console.log(`[sprint] Resumed via API: team=${state.teamName}, tasks=${state.tasks.length}`);

    // Asynchronously reconnect to existing tmux session
    reconnectTmuxSession();
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ resumed: true, teamName: state.teamName }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- Start ---

const { port } = parseArgs();
const server = createServer(handleRequest);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "init", state }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "terminal_input" && msg.agentName && msg.data && state.tmuxSessionName) {
        const paneIdx = tmux.getPaneForAgent(msg.agentName);
        if (paneIdx !== null) {
          const target = `${state.tmuxSessionName}:0.${paneIdx}`;
          tmux.sendKeys(target, msg.data).catch(() => {});
        }
      }
    } catch {}
  });

  ws.on("close", () => clients.delete(ws));
});

// --- Tmux detection ---
tmux.isTmuxAvailable().then((available) => {
  state.tmuxAvailable = available;
  console.log(`[tmux] ${available ? "available" : "not available"}`);
  // Notify already-connected clients
  broadcast({ type: "init", state });
});

// --- Tmux pane discovery + polling bootstrap ---

function discoverAndPollPanes(session: string, agents: string[]) {
  tmux.attributePanes(session, agents);
  console.log(`[tmux] Attributed ${agents.length} agents to panes`);

  // Wait for panes to appear (Claude creates splits asynchronously)
  let retries = 0;
  const waitForPanes = setInterval(async () => {
    retries++;
    const panes = await tmux.listPanes(session);
    if (panes.length > 1 || retries >= 10) {
      clearInterval(waitForPanes);
      const discovered = panes.map((p) => {
        let agentName: string | null = null;
        for (const a of agents) {
          if (tmux.getPaneForAgent(a) === String(p.index)) {
            agentName = a;
            break;
          }
        }
        return { agentName, paneIndex: p.index };
      });
      broadcast({ type: "panes_discovered", panes: discovered });
      startPanePolling();
      console.log(`[tmux] Pane polling started (${panes.length} panes)`);
    }
  }, 2000);
}

setTeamDiscoveredHook((agents) => {
  if (!state.tmuxSessionName) return;
  discoverAndPollPanes(state.tmuxSessionName, agents);
});

/** Try to find and reconnect to an existing tc-* tmux session */
async function reconnectTmuxSession() {
  const session = await tmux.findSprintSession();
  if (!session) return;
  state.tmuxSessionName = session;
  state.tmuxAvailable = true;
  console.log(`[tmux] Reconnected to session: ${session}`);
  broadcast({ type: "init", state });

  if (state.agents.length) {
    discoverAndPollPanes(session, state.agents.map((a) => a.name));
  }
  tmuxSessionCheckInterval = setInterval(async () => {
    const alive = await tmux.hasSession(session);
    if (!alive) {
      console.log(`[sprint] tmux session ${session} ended`);
      stopPanePolling();
      state.tmuxSessionName = null;
      broadcast({ type: "process_exited", code: 0 });
    }
  }, 5000);
}

setProjectRoot(process.cwd());
migrateGlobalAnalytics();

state.projectName = detectProjectName();

// Resume interrupted sprint from persisted state
const persisted = loadPersistedState();
if (persisted && persisted.teamName) {
  const { tmuxAvailable: _, tmuxSessionName: __, projectName: ___, ...resumable } = persisted;
  Object.assign(state, resumable);
  console.log(`[sprint] Resumed sprint state: team=${state.teamName}, tasks=${state.tasks.length}`);
  reconnectTmuxSession();
}

server.listen(port, () => {
  console.log(`[sprint] Project: ${state.projectName}`);
  console.log(`[sprint] Visualization: http://localhost:${port}`);
  startWatching(TEAMS_DIR, TASKS_DIR);
});

function cleanup() {
  if (sprintProcess) {
    sprintProcess.process.kill("SIGTERM");
    sprintProcess = null;
  }
  if (state.tmuxSessionName) {
    // Synchronous-ish: fire and forget, then exit
    tmux.killSession(state.tmuxSessionName).catch(() => {});
    stopPanePolling();
    tmux.reset();
  }
  flushSave(state);
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
