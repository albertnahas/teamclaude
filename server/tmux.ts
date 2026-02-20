import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Types ---

export interface PaneInfo {
  index: number;
  width: number;
  height: number;
  active: boolean;
  title: string;
}

// --- Pane-to-agent mapping ---

const paneAgentMap = new Map<number, string>();
let lastCaptured = new Map<string, string>();

export function attributePanes(
  _session: string,
  agents: string[]
): void {
  paneAgentMap.clear();
  // Pane 0 = orchestrator (lead Claude), panes 1..N = agents in order
  for (let i = 0; i < agents.length; i++) {
    paneAgentMap.set(i + 1, agents[i]);
  }
}

export function getPaneForAgent(agentName: string): string | null {
  for (const [idx, name] of paneAgentMap) {
    if (name === agentName) return String(idx);
  }
  return null;
}

export function reset(): void {
  paneAgentMap.clear();
  lastCaptured.clear();
}

// --- Tmux CLI wrappers ---

async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: 10_000,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  return stdout;
}

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await tmux("-V");
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an existing sprint tmux session (tc-* prefix).
 * Returns the session name or null if none found.
 */
export async function findSprintSession(): Promise<string | null> {
  try {
    const out = await tmux("list-sessions", "-F", "#{session_name}");
    const sessions = out.trim().split("\n").filter(Boolean);
    return sessions.find((s) => s.startsWith("tc-")) ?? null;
  } catch {
    return null;
  }
}

export async function createSession(name: string): Promise<void> {
  await tmux(
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "220",
    "-y",
    "50"
  );
}

export async function killSession(name: string): Promise<void> {
  try {
    await tmux("kill-session", "-t", name);
  } catch {
    // Session may already be dead
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await tmux("has-session", "-t", name);
    return true;
  } catch {
    return false;
  }
}

export async function listPanes(session: string): Promise<PaneInfo[]> {
  try {
    const out = await tmux(
      "list-panes",
      "-t",
      session,
      "-F",
      "#{pane_index}:#{pane_width}:#{pane_height}:#{pane_active}:#{pane_title}"
    );
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [idx, w, h, active, ...titleParts] = line.split(":");
        return {
          index: parseInt(idx, 10),
          width: parseInt(w, 10),
          height: parseInt(h, 10),
          active: active === "1",
          title: titleParts.join(":"),
        };
      });
  } catch {
    return [];
  }
}

export async function capturePane(target: string): Promise<string> {
  return tmux("capture-pane", "-p", "-e", "-t", target);
}

export async function sendKeys(
  target: string,
  keys: string
): Promise<void> {
  await tmux("send-keys", "-t", target, "-l", keys);
}

export async function sendSpecialKey(
  target: string,
  key: string
): Promise<void> {
  await tmux("send-keys", "-t", target, key);
}

/**
 * Returns captured pane content only if it changed since last poll.
 * Returns null when content is unchanged (no delta).
 */
export async function pollPane(
  sessionTarget: string
): Promise<string | null> {
  try {
    const content = await capturePane(sessionTarget);
    const prev = lastCaptured.get(sessionTarget);
    if (content === prev) return null;
    lastCaptured.set(sessionTarget, content);
    return content;
  } catch {
    return null;
  }
}
