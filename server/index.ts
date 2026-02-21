import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { WebSocketServer } from "ws";

import { setProjectRoot, sprintHistoryDir } from "./storage.js";
import { state, clients, broadcast, detectProjectName, setRecordHook } from "./state.js";
import { loadPersistedState, flushSave } from "./persistence.js";
import { startWatching, setTeamDiscoveredHook } from "./watcher.js";
import { migrateGlobalAnalytics } from "./analytics.js";
import * as tmux from "./tmux.js";
import { initNotifications } from "./notifications.js";
import { loadPlugins } from "./plugin-loader.js";
import { handleRequest } from "./http-handlers.js";
import { sprintCtx, stopPanePolling, discoverAndPollPanes, reconnectTmuxSession } from "./sprint-lifecycle.js";
import { Recorder } from "./replay.js";

// --- Re-exports for testing ---

/** Reset lastRetro — for testing only */
export function _resetLastRetro() { sprintCtx.lastRetro = null; }

// --- CLI flags ---

function parseArgs(): { port: number; recordingEnabled: boolean } {
  const args = process.argv.slice(2);
  let port: number | null = null;
  let recordingEnabled = false;

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
        const portMatch = raw.match(/^server:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+port:\s*(\d+)/m);
        if (portMatch) port = parseInt(portMatch[1], 10);
        // recording: enabled: true
        if (/^recording:\s*\n[\s\S]*?^\s+enabled:\s*true/m.test(raw)) {
          recordingEnabled = true;
        }
      } catch {}
    }
  }

  return { port: port ?? 3456, recordingEnabled };
}

// --- Paths ---

const CLAUDE_DIR = join(homedir(), ".claude");
const TEAMS_DIR = join(CLAUDE_DIR, "teams");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

// --- Recording setup ---

const { port, recordingEnabled } = parseArgs();
const recorder = new Recorder();

if (recordingEnabled) {
  console.log("[recording] Auto-recording enabled");

  // Attach replay file in the sprint history dir when a sprint starts.
  // The sprint ID is set by http-handlers before calling this callback.
  sprintCtx.onSprintStart = (sprintId: string) => {
    const replayFile = join(sprintHistoryDir(sprintId), "replay.jsonl");
    recorder.attach(replayFile);
    console.log(`[recording] Writing to: ${replayFile}`);
  };

  setRecordHook((event) => recorder.record(event));
}

sprintCtx.onSprintStop = () => {
  if (recordingEnabled) {
    recorder.reset();
  }
};

// --- Server setup ---

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
          tmux.sendKeys(`${state.tmuxSessionName}:0.${paneIdx}`, msg.data).catch(() => {});
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
  broadcast({ type: "init", state });
});

// --- Tmux pane discovery hook ---

setTeamDiscoveredHook((agents) => {
  if (!state.tmuxSessionName) return;
  discoverAndPollPanes(state.tmuxSessionName, agents);
});

// --- Startup ---

setProjectRoot(process.cwd());
migrateGlobalAnalytics();

state.projectName = detectProjectName();
initNotifications(process.cwd(), state.projectName);
loadPlugins(process.cwd()).catch((err: Error) => {
  console.error("[plugins] Failed to load plugins:", err.message);
});

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

// --- Cleanup ---

function cleanup() {
  if (sprintCtx.sprintProcess) {
    sprintCtx.sprintProcess.process.kill("SIGTERM");
    sprintCtx.sprintProcess = null;
  }
  if (state.tmuxSessionName) {
    tmux.killSession(state.tmuxSessionName).catch(() => {});
    stopPanePolling();
    tmux.reset();
  }
  flushSave(state);
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
