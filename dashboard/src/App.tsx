import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SprintState, WsEvent, AppPhase, MergeConflict } from "./types";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
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
import { ReplayControls } from "./components/ReplayControls";
import { MemoryViewer } from "./components/MemoryViewer";

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
  validatingTaskIds: [],
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

function TokenBudgetWarning({ level, onDismiss }: { level: "approaching" | "exceeded"; onDismiss: () => void }) {
  const exceeded = level === "exceeded";
  const bg = exceeded ? "#7f1d1d" : "#78350f";
  const textColor = exceeded ? "#fca5a5" : "#fcd34d";
  const strongColor = exceeded ? "#f87171" : "#fbbf24";
  const borderColor = exceeded ? "#f87171" : "#fbbf24";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        padding: "10px 20px",
        background: bg,
        color: textColor,
        fontSize: 13,
        zIndex: 210,
        display: "flex",
        alignItems: "center",
        gap: 12,
        animation: "slideDown 0.3s ease-out",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>!</span>
      <span style={{ flex: 1 }}>
        {exceeded ? (
          <>
            <strong style={{ color: strongColor }}>Token budget exceeded</strong>
            {" — sprint paused. Review usage and resume when ready."}
          </>
        ) : (
          <>
            <strong style={{ color: strongColor }}>Token budget approaching limit</strong>
            {" — over 80% of budget used."}
          </>
        )}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: "transparent",
          border: `1px solid ${borderColor}`,
          color: borderColor,
          borderRadius: 4,
          padding: "2px 10px",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function AgentDetailView({
  agentName,
  agents,
  messages,
  tokenUsage,
  onBack,
}: {
  agentName: string;
  agents: SprintState["agents"];
  messages: SprintState["messages"];
  tokenUsage: SprintState["tokenUsage"];
  onBack: () => void;
}) {
  const agent = agents.find((a) => a.name === agentName);
  const agentMessages = messages.filter((m) => m.from === agentName || m.to === agentName);
  const tokens = tokenUsage.byAgent[agentName] ?? 0;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [agentMessages.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="terminal-header">
        <button className="terminal-back-btn" onClick={onBack}>← Back</button>
        <span className="terminal-agent-name">{agentName}</span>
        {agent && (
          <span style={{
            marginLeft: 8,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: agent.status === "active" ? "var(--green)" : "var(--text-muted)",
          }}>
            {agent.status}
          </span>
        )}
        {tokens > 0 && (
          <span className="terminal-pane-hint">{tokens.toLocaleString()} tok</span>
        )}
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {agentMessages.length === 0 ? (
          <div className="empty-state">No messages yet</div>
        ) : agentMessages.map((m) => (
          <div key={m.id} style={{ padding: "4px 0", fontSize: 12, lineHeight: 1.5 }}>
            <div className="message-meta">
              <span className="message-from">{m.from}</span>
              <span className="message-arrow">→</span>
              <span className="message-to">{m.to}</span>
              {m.protocol && <span className="message-protocol">{m.protocol}</span>}
            </div>
            <div className="message-content">{m.content.slice(0, 300)}{m.content.length > 300 ? "…" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
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
    case "token_budget_approaching":
      return { ...state, tokenBudgetApproaching: true, tokenUsage: event.usage };
    case "token_budget_exceeded":
      return { ...state, tokenBudgetApproaching: true, tokenBudgetExceeded: true, paused: true, tokenUsage: event.usage };
    case "task_validation":
      return { ...state, validatingTaskIds: state.validatingTaskIds.filter((id) => id !== event.taskId) };
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
  const [budgetWarningDismissed, setBudgetWarningDismissed] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(10);
  const [replayComplete, setReplayComplete] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const replayEventCount = useRef(0);
  const replayTotalEvents = useRef(0);
  const taskSearchRef = useRef<HTMLInputElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [msgHeight, setMsgHeight] = useState(280);
  const dragRef = useRef<{ type: "h" | "v"; startPos: number; startSize: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      if (d.type === "h") {
        setSidebarWidth(Math.max(180, Math.min(600, d.startSize + e.clientX - d.startPos)));
      } else {
        setMsgHeight(Math.max(80, Math.min(600, d.startSize + d.startPos - e.clientY)));
      }
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleWsEvent = useCallback((event: WsEvent) => {
    if (event.type === "replay_complete") {
      setReplayComplete(true);
      return;
    }
    if (event.type === "replay_start") {
      replayTotalEvents.current = event.totalEvents;
      replayEventCount.current = 0;
      return;
    }
    dispatch(event);
    replayEventCount.current += 1;
    if (event.type === "init") {
      if (event.state.teamName) setAppPhase("replay");
      else if (event.state.phase !== "idle") setAppPhase("sprint");
      // Reset budget warning when state is re-initialized
      if (!event.state.tokenBudgetApproaching && !event.state.tokenBudgetExceeded) setBudgetWarningDismissed(false);
    }
    // When server signals process exited and no team is active, return to setup
    if (event.type === "process_exited" && !sprintState.teamName) {
      setAppPhase("setup");
    }
    if (event.type === "token_budget_approaching" || event.type === "token_budget_exceeded") {
      setBudgetWarningDismissed(false);
    }
    if (event.type === "cycle_info" && event.phase !== "idle") {
      if (appPhase !== "replay") setAppPhase("sprint");
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
  }, [appPhase]);

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
    try {
      const res = await fetch("/api/stop", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as RetroData;
      if (data.retro || data.prSummary) {
        setRetroData(data);
      } else {
        setAppPhase("setup");
      }
    } catch {
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

  useKeyboardShortcuts({
    "?": () => setShowShortcuts((s) => !s),
    "p": handlePause,
    "Escape": () => setShowShortcuts(false),
    "t": () => { taskSearchRef.current?.focus(); taskSearchRef.current?.select(); },
  });

  if (appPhase === "setup") {
    return (
      <>
        <SetupPhase onLaunch={handleLaunch} theme={theme} onToggleTheme={toggleTheme} />
        {retroData && <RetroModal data={retroData} onClose={handleRetroClose} />}
      </>
    );
  }

  if (appPhase === "planning") {
    return (
      <PlanningPhase
        onApprove={handlePlanApprove}
        onReject={handlePlanReject}
        onUpdateEngineers={(n) => setPendingLaunch((prev) =>
          prev ? { ...prev, config: { ...prev.config, engineers: n } } : null
        )}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const handleReplayRestart = () => {
    setReplayComplete(false);
    replayEventCount.current = 0;
    replayTotalEvents.current = 0;
    // Reconnect WebSocket to restart replay from server side
    window.location.reload();
  };

  return (
    <div id="sprint-phase">
      {appPhase === "replay" && (
        <ReplayControls
          totalEvents={replayTotalEvents.current}
          currentEvent={replayEventCount.current}
          speed={replaySpeed}
          complete={replayComplete}
          onSpeedChange={setReplaySpeed}
          onRestart={handleReplayRestart}
        />
      )}

      {(sprintState.tokenBudgetExceeded || sprintState.tokenBudgetApproaching) && !budgetWarningDismissed && (
        <TokenBudgetWarning
          level={sprintState.tokenBudgetExceeded ? "exceeded" : "approaching"}
          onDismiss={() => setBudgetWarningDismissed(true)}
        />
      )}

      {sprintState.escalation && (
        <EscalationBar
          escalation={sprintState.escalation}
          onDismiss={handleDismissEscalation}
        />
      )}

      {sprintState.mergeConflict && (
        <MergeConflictBar conflict={sprintState.mergeConflict} />
      )}

      <SprintBar
        state={sprintState}
        theme={theme}
        onPause={handlePause}
        onStop={handleStop}
        onToggleTheme={toggleTheme}
        onShowShortcuts={() => setShowShortcuts((s) => !s)}
        onShowMemory={() => setShowMemory(true)}
      />

      <div className="container" style={{ "--sidebar-w": `${sidebarWidth}px`, "--msg-h": `${msgHeight}px` } as React.CSSProperties}>
        <div className="panel agents-panel" style={{ overflow: "hidden" }}>
          {openTerminalAgent && sprintState.tmuxSessionName ? (
            <TerminalView
              agentName={openTerminalAgent}
              lines={terminalState.lines}
              onBack={() => setOpenTerminalAgent(null)}
              paneIndex={null}
              availablePanes={terminalState.panes}
            />
          ) : openTerminalAgent ? (
            <AgentDetailView
              agentName={openTerminalAgent}
              agents={sprintState.agents}
              messages={sprintState.messages}
              tokenUsage={sprintState.tokenUsage}
              onBack={() => setOpenTerminalAgent(null)}
            />
          ) : (
            <AgentTopology
              agents={sprintState.agents}
              tokenUsage={sprintState.tokenUsage}
              tmuxAvailable={sprintState.tmuxAvailable}
              onAgentClick={setOpenTerminalAgent}
            />
          )}
        </div>

        <div className="resize-h" onMouseDown={(e) => {
          dragRef.current = { type: "h", startPos: e.clientX, startSize: sidebarWidth };
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }} />

        <TasksPanel
          tasks={sprintState.tasks}
          reviewTaskIds={sprintState.reviewTaskIds}
          validatingTaskIds={sprintState.validatingTaskIds}
          searchInputRef={taskSearchRef}
        />

        <div className="resize-v" onMouseDown={(e) => {
          dragRef.current = { type: "v", startPos: e.clientY, startSize: msgHeight };
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
        }} />

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

      {showMemory && <MemoryViewer onClose={() => setShowMemory(false)} />}

      {showShortcuts && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setShowShortcuts(false)}
        >
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: "24px 32px",
              minWidth: 300,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 14 }}>Keyboard Shortcuts</div>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <tbody>
                {[
                  ["?", "Toggle this help overlay"],
                  ["p", "Pause / Resume sprint"],
                  ["t", "Focus task search"],
                  ["Esc", "Close overlay"],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td style={{ paddingRight: 20, paddingBottom: 10 }}>
                      <kbd
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 4,
                          padding: "2px 8px",
                          color: "var(--text-primary)",
                        }}
                      >
                        {key}
                      </kbd>
                    </td>
                    <td style={{ color: "var(--text-secondary)", paddingBottom: 10 }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setShowShortcuts(false)}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "6px 0",
                background: "transparent",
                border: "1px solid var(--border-subtle)",
                borderRadius: 4,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
