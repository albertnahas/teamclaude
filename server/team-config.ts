import { basename, dirname } from "node:path";
import {
  state,
  teamInitMessageSent,
  setTeamInitMessageSent,
  safeReadJSON,
  broadcast,
} from "./state.js";
import type { AgentInfo, Message } from "./state.js";
import { notifyWebhook } from "./notifications.js";
import { fireOnSprintStart } from "./plugin-loader.js";
import { loadGitHubConfig, createIssuesForSprint } from "./github.js";

export function inferAgentType(name: string): string {
  if (name.includes("engineer")) return "sprint-engineer";
  if (name.includes("manager")) return "sprint-manager";
  if (name.includes("pm")) return "sprint-pm";
  return "unknown";
}

/** Auto-discover an agent from inbox traffic if not already known. */
export function ensureAgent(name: string): AgentInfo | null {
  if (!name || name === "unknown" || name === "system" || name === "all") return null;
  const existing = state.agents.find((a) => a.name === name);
  if (existing) return existing;
  const agent: AgentInfo = {
    name,
    agentId: `${name}@${state.teamName ?? "unknown"}`,
    agentType: inferAgentType(name),
    status: "active",
  };
  state.agents.push(agent);
  broadcast({ type: "agent_status", agent });
  return agent;
}

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

  notifyWebhook("sprint_started", {
    teamName,
    mode: state.mode,
    taskCount: state.tasks.length,
  });
  fireOnSprintStart(state);

  const ghConfig = loadGitHubConfig(process.cwd());
  if (ghConfig && state.tasks.length > 0) {
    createIssuesForSprint(state.tasks, ghConfig).catch(() => {});
  }

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
