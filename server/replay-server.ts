/**
 * Replay server — serves the dashboard and replays a recording file.
 * Started by `npx teamclaude replay <file.json>`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs";
import { join, resolve, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadRecording, startReplay } from "./replay.js";

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--")) ?? "";
const portArg = args.indexOf("--port");
const port = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 3456;
const speedArg = args.indexOf("--speed");
const speed = speedArg !== -1 ? parseFloat(args[speedArg + 1]) : 10;

if (!fileArg) {
  console.error("Usage: teamclaude replay <file.jsonl> [--port 3456] [--speed 2]");
  process.exit(1);
}

const recordingFile = resolve(fileArg);

let recording;
try {
  recording = loadRecording(recordingFile);
} catch (err: any) {
  console.error(`[replay] Failed to load recording: ${err.message}`);
  process.exit(1);
}

const uiDir = import.meta.dirname ?? pathDirname(fileURLToPath(import.meta.url));

let currentSpeed = speed;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
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

  if (url === "/" || url === "/index.html") {
    readFile(join(uiDir, "ui.html"), "utf-8", (err, html) => {
      if (err) {
        res.writeHead(500);
        res.end("Failed to load UI");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...cors });
      res.end(html);
    });
    return;
  }

  if (url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ teamName: null, projectName: "replay", agents: [], tasks: [], messages: [], paused: false, escalation: null, mergeConflict: null, mode: "manual", cycle: 0, phase: "idle", reviewTaskIds: [], tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 }, checkpoints: [], pendingCheckpoint: null, tmuxAvailable: false, tmuxSessionName: null }));
    return;
  }

  if (url === "/api/replay/speed" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      try {
        const { speed: newSpeed } = JSON.parse(body) as { speed: number };
        if (typeof newSpeed === "number" && newSpeed > 0) {
          currentSpeed = newSpeed;
          // Restart replay with new speed for each connected client
          for (const [ws, cancel] of clientCancels) {
            cancel();
            clientCancels.set(ws, startReplay(recording, ws, currentSpeed));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ speed: currentSpeed }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "Invalid body" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });
// Per-client cancel functions — each client gets its own replay instance
const clientCancels = new Map<import("ws").WebSocket, () => void>();

wss.on("connection", (ws) => {
  // Start an independent replay for this client only
  const cancel = startReplay(recording, ws, currentSpeed);
  clientCancels.set(ws, cancel);

  ws.on("close", () => {
    clientCancels.get(ws)?.();
    clientCancels.delete(ws);
  });
});

server.listen(port, () => {
  console.log(`[replay] Replaying: ${recordingFile}`);
  console.log(`[replay] Speed: ${speed}x | Dashboard: http://localhost:${port}`);
  console.log(`[replay] ${recording.events.length} events`);
});
