import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { WebSocketServer } from "ws";

import { state, clients, broadcast, resetState } from "./state.js";
import { startWatching } from "./watcher.js";
import { compileSprintPrompt } from "./prompt.js";

// --- CLI flags ---

function parseArgs(): { port: number } {
  const args = process.argv.slice(2);
  let port = 3456;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { port };
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

// --- HTTP handlers ---

function serveUI(_req: IncomingMessage, res: ServerResponse) {
  const uiPath = join(import.meta.dirname || __dirname, "ui.html");
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

function handleLaunch(
  req: IncomingMessage,
  res: ServerResponse,
  cors: Record<string, string>
) {
  if (sprintProcess) {
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

      const prompt = compileSprintPrompt(
        roadmap || "",
        engineers,
        includePM,
        cycles
      );
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
        startedAt: Date.now(),
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

      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(
        JSON.stringify({
          pid: child.pid,
          startedAt: sprintProcess.startedAt,
        })
      );
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
        running: !!sprintProcess,
        pid: sprintProcess?.pid ?? null,
        startedAt: sprintProcess?.startedAt ?? null,
      })
    );
  } else if (req.url === "/api/launch" && req.method === "POST") {
    handleLaunch(req, res, cors);
  } else if (req.url === "/api/stop" && req.method === "POST") {
    if (sprintProcess) {
      sprintProcess.process.kill("SIGTERM");
      sprintProcess = null;
    }
    resetState();
    broadcast({ type: "init", state });
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true }));
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
  ws.on("close", () => clients.delete(ws));
});

server.listen(port, () => {
  console.log(`[sprint] Visualization: http://localhost:${port}`);
  startWatching(TEAMS_DIR, TASKS_DIR);
});

function cleanup() {
  if (sprintProcess) {
    sprintProcess.process.kill("SIGTERM");
    sprintProcess = null;
  }
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
