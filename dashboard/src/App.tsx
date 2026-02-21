import { useCallback, useReducer, useState } from "react";
import type { SprintState, WsEvent, AppPhase, MergeConflict } from "./types";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { SetupPhase } from "./components/SetupPhase";
import { PlanningPhase } from "./components/PlanningPhase";
import { SprintBar } from "./components/SprintBar";
import { AgentTopology } from "./components/AgentTopology";
import { TasksPanel } from "./components/TasksPanel";
import { MessageFeed } from "./components/MessageFeed";
import { TerminalView } from "./components/TerminalView";
import { CheckpointModal } from "./components/CheckpointModal";
import { RetroModal } from "./components/RetroModal";
import { EscalationBar } from "./components/EscalationBar";

const initialState: SprintState = {
  teamName: null,
  projectName: null,
  agents: [],
  tasks: [],
  messages: [],
  paused: false,
  escalation: null,
  mergeConflict: null,
  mode: "manual",
  cycle: 0,
  phase: "idle",
  reviewTaskIds: [],
  tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
  checkpoints: [],
  pendingCheckpoint: null,
  tmuxAvailable: false,
  tmuxSessionName: null,
};

interface TerminalLine {
  agentName: string;
  paneIndex: number;
  content: string;
}

interface TerminalAppState {
  lines: TerminalLine[];
  panes: { agentName: string | null; paneIndex: number }[];
}

function MergeConflictBar({ conflict }: { conflict: MergeConflict }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        padding: "10px 20px",
        background: "#78350f",
        color: "#fcd34d",
        fontSize: 12,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: 12,
        animation: "slideDown 0.3s ease-out",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>!</span>
      <span style={{ flex: 1 }}>
        <strong style={{ color: "#fbbf24" }}>{conflict.engineerName}</strong> has a merge conflict on{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>{conflict.worktreeBranch}</span>
        {conflict.conflictingFiles.length > 0 && (
          <> — {conflict.conflictingFiles.join(", ")}</>
        )}
      </span>
    </div>
  );
}

function sprintReducer(state: SprintState, event: WsEvent): SprintState {
  switch (event.type) {
    case "init":
      return event.state;
    case "task_updated": {
      const idx = state.tasks.findIndex((t) => t.id === event.task.id);
      if (idx === -1) return { ...state, tasks: [...state.tasks, event.task] };
      const tasks = [...state.tasks];
      tasks[idx] = event.task;
      return { ...state, tasks };
    }
    case "message_sent":
      return { ...state, messages: [...state.messages, event.message] };
    case "agent_status": {
      const idx = state.agents.findIndex((a) => a.agentId === event.agent.agentId);
      if (idx === -1) return { ...state, agents: [...state.agents, event.agent] };
      const agents = [...state.agents];
      agents[idx] = event.agent;
      return { ...state, agents };
    }
    case "paused":
      return { ...state, paused: event.paused };
    case "escalation":
      return { ...state, escalation: event.escalation };
    case "merge_conflict":
      return { ...state, mergeConflict: event.mergeConflict };
    case "cycle_info":
      return { ...state, cycle: event.cycle, phase: event.phase, mode: event.mode };
    case "token_usage":
      return { ...state, tokenUsage: event.usage };
    case "checkpoint":
      return { ...state, pendingCheckpoint: event.checkpoint };
    default:
      return state;
  }
}

interface RetroData {
  branch?: string;
  retro?: string;
  prSummary?: string;
}

export default function App() {
  const [appPhase, setAppPhase] = useState<AppPhase>("setup");
  const [sprintState, dispatch] = useReducer(sprintReducer, initialState);
  const [retroData, setRetroData] = useState<RetroData | null>(null);
  const [terminalState, setTerminalState] = useState<TerminalAppState>({ lines: [], panes: [] });
  const [openTerminalAgent, setOpenTerminalAgent] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const handleWsEvent = useCallback((event: WsEvent) => {
    dispatch(event);
    if (event.type === "init" && event.state.phase !== "idle") {
      setAppPhase("sprint");
    }
    if (event.type === "cycle_info" && event.phase !== "idle") {
      setAppPhase("sprint");
    }
    if (event.type === "terminal_output") {
      setTerminalState((prev) => ({
        ...prev,
        lines: [
          ...prev.lines,
          { agentName: event.agentName, paneIndex: event.paneIndex, content: event.content },
        ],
      }));
    }
    if (event.type === "panes_discovered") {
      setTerminalState((prev) => ({ ...prev, panes: event.panes }));
    }
  }, []);

  useWebSocket(handleWsEvent);

  const [pendingLaunch, setPendingLaunch] = useState<{
    roadmap: string;
    config: { engineers: number; includePM: boolean; cycles: number };
  } | null>(null);

  const handleLaunch = (
    roadmap: string,
    config: { engineers: number; includePM: boolean; cycles: number }
  ) => {
    setPendingLaunch({ roadmap, config });
    setAppPhase("planning");
  };

  const handlePlanApprove = async () => {
    if (!pendingLaunch) return;
    await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roadmap: pendingLaunch.roadmap, ...pendingLaunch.config }),
    });
    setPendingLaunch(null);
    setAppPhase("sprint");
  };

  const handlePlanReject = () => {
    setPendingLaunch(null);
    setAppPhase("setup");
  };

  const handlePause = () => {
    fetch("/api/pause", { method: "POST" });
  };

  const handleStop = async () => {
    const res = await fetch("/api/stop", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as RetroData;
    if (data.retro || data.prSummary) {
      setRetroData(data);
    } else {
      setAppPhase("setup");
    }
  };

  const handleCheckpointRelease = () => {
    fetch("/api/checkpoint/release", { method: "POST" });
  };

  const handleDismissEscalation = () => {
    fetch("/api/dismiss-escalation", { method: "POST" });
  };

  const handleRetroClose = () => {
    setRetroData(null);
    setAppPhase("setup");
  };

  if (appPhase === "setup") {
    return <SetupPhase onLaunch={handleLaunch} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (appPhase === "planning") {
    return (
      <PlanningPhase
        onApprove={handlePlanApprove}
        onReject={handlePlanReject}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <div id="sprint-phase">
      {sprintState.escalation && (
        <EscalationBar
          escalation={sprintState.escalation}
          onDismiss={handleDismissEscalation}
        />
      )}

      {sprintState.mergeConflict && (
        <MergeConflictBar conflict={sprintState.mergeConflict} />
      )}

      <SprintBar state={sprintState} theme={theme} onPause={handlePause} onStop={handleStop} onToggleTheme={toggleTheme} />

      <div className="container">
        <div className="panel agents-panel" style={{ overflow: "hidden" }}>
          {openTerminalAgent && sprintState.tmuxSessionName ? (
            <TerminalView
              agentName={openTerminalAgent}
              lines={terminalState.lines}
              onBack={() => setOpenTerminalAgent(null)}
              paneIndex={null}
              availablePanes={terminalState.panes}
            />
          ) : (
            <AgentTopology
              agents={sprintState.agents}
              tokenUsage={sprintState.tokenUsage}
              tmuxAvailable={sprintState.tmuxAvailable}
              onAgentClick={sprintState.tmuxSessionName ? setOpenTerminalAgent : undefined}
            />
          )}
        </div>

        <div className="resize-h" />

        <TasksPanel tasks={sprintState.tasks} reviewTaskIds={sprintState.reviewTaskIds} />

        <div className="resize-v" />

        <MessageFeed messages={sprintState.messages} />
      </div>

      {sprintState.pendingCheckpoint && (
        <CheckpointModal
          checkpoint={sprintState.pendingCheckpoint}
          onApprove={handleCheckpointRelease}
          onSkip={handleCheckpointRelease}
        />
      )}

      {retroData && <RetroModal data={retroData} onClose={handleRetroClose} />}
    </div>
  );
}
