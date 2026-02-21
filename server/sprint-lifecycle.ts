import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

import { state, broadcast } from "./state.js";
import * as tmux from "./tmux.js";

// --- Shared mutable sprint context ---

export const sprintCtx: {
  sprintProcess: {
    pid: number;
    process: ChildProcess;
    startedAt: number;
    config: { roadmap: string; engineers: number; includePM: boolean };
  } | null;
  sprintBranch: string | null;
  lastRetro: string | null;
  /** Current sprint ID — set on launch, used by stop handler for consistent history paths */
  currentSprintId: string | null;
  panePollingInterval: ReturnType<typeof setInterval> | null;
  tmuxSessionCheckInterval: ReturnType<typeof setInterval> | null;
  /** Called when a sprint starts — for recording setup */
  onSprintStart: ((sprintId: string) => void) | null;
  /** Called after a sprint stops */
  onSprintStop: (() => void) | null;
} = {
  sprintProcess: null,
  sprintBranch: null,
  lastRetro: null,
  currentSprintId: null,
  panePollingInterval: null,
  tmuxSessionCheckInterval: null,
  onSprintStart: null,
  onSprintStop: null,
};

// --- Tmux pane polling ---

export function stopPanePolling() {
  if (sprintCtx.panePollingInterval) {
    clearInterval(sprintCtx.panePollingInterval);
    sprintCtx.panePollingInterval = null;
  }
  if (sprintCtx.tmuxSessionCheckInterval) {
    clearInterval(sprintCtx.tmuxSessionCheckInterval);
    sprintCtx.tmuxSessionCheckInterval = null;
  }
}

export function startPanePolling() {
  if (sprintCtx.panePollingInterval) return;
  const session = state.tmuxSessionName;
  if (!session) return;

  sprintCtx.panePollingInterval = setInterval(async () => {
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

// --- Tmux pane discovery ---

export function discoverAndPollPanes(session: string, agents: string[]) {
  tmux.attributePanes(session, agents);
  console.log(`[tmux] Attributed ${agents.length} agents to panes`);

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

// --- Tmux session reconnect ---

export async function reconnectTmuxSession() {
  const session = await tmux.findSprintSession();
  if (!session) return;
  state.tmuxSessionName = session;
  state.tmuxAvailable = true;
  console.log(`[tmux] Reconnected to session: ${session}`);
  broadcast({ type: "init", state });

  if (state.agents.length) {
    discoverAndPollPanes(session, state.agents.map((a) => a.name));
  }
  sprintCtx.tmuxSessionCheckInterval = setInterval(async () => {
    const alive = await tmux.hasSession(session);
    if (!alive) {
      console.log(`[sprint] tmux session ${session} ended`);
      stopPanePolling();
      state.tmuxSessionName = null;
      broadcast({ type: "process_exited", code: 0 });
    }
  }, 5000);
}

// --- Launch helpers ---

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export async function launchViaTmux(
  prompt: string,
  sessionName: string,
  startedAt: number,
  onSuccess: (pid: number, tmux: boolean) => void
) {
  await tmux.createSession(sessionName);
  state.tmuxSessionName = sessionName;

  const promptFile = join(homedir(), ".claude", `sprint-prompt-${sessionName}.txt`);
  writeFileSync(promptFile, prompt, "utf-8");

  const cmd = `unset CLAUDECODE && claude -p "$(cat ${shellEscape(promptFile)})" --permission-mode bypassPermissions; rm -f ${shellEscape(promptFile)}`;
  await tmux.sendKeys(`${sessionName}:0.0`, cmd);
  await tmux.sendSpecialKey(`${sessionName}:0.0`, "Enter");

  console.log(`[sprint] Launched claude in tmux session: ${sessionName}`);
  broadcast({ type: "process_started", pid: 0 });

  sprintCtx.tmuxSessionCheckInterval = setInterval(async () => {
    const alive = await tmux.hasSession(sessionName);
    if (!alive) {
      console.log(`[sprint] tmux session ${sessionName} ended`);
      stopPanePolling();
      sprintCtx.sprintProcess = null;
      broadcast({ type: "process_exited", code: 0 });
    }
  }, 5000);

  onSuccess(0, true);
}

export function launchViaSpawn(
  prompt: string,
  roadmap: string,
  engineers: number,
  includePM: boolean,
  startedAt: number,
  onSuccess: (pid: number, startedAt: number) => void
) {
  const tmpFile = join(tmpdir(), `teamclaude-prompt-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);

  const env = { ...process.env };
  delete env.CLAUDECODE;
  const child = spawn(
    "claude",
    ["-p", `cat ${tmpFile}`, "--permission-mode", "bypassPermissions"],
    { stdio: ["ignore", "pipe", "pipe"], env }
  );

  const pid = child.pid!;
  sprintCtx.sprintProcess = {
    pid,
    process: child,
    startedAt,
    config: { roadmap, engineers, includePM },
  };

  setTimeout(() => { try { unlinkSync(tmpFile); } catch {} }, 5000);

  console.log(`[sprint] Launched claude process (PID ${pid})`);
  broadcast({ type: "process_started", pid });

  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[claude] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[claude:err] ${d}`));

  child.on("exit", (code) => {
    console.log(`[sprint] Claude process exited (code ${code})`);
    sprintCtx.sprintProcess = null;
    broadcast({ type: "process_exited", code });
  });

  onSuccess(pid, startedAt);
}
