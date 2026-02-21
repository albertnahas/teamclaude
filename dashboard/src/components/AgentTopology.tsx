import type { AgentInfo, SprintState } from "../types";

interface AgentTopologyProps {
  agents: AgentInfo[];
  tokenUsage: SprintState["tokenUsage"];
  tmuxAvailable: boolean;
  onAgentClick?: (agentName: string) => void;
}

const CENTER = { x: 140, y: 180 };
const ORBIT_RADIUS = 110;

function agentPosition(index: number, total: number) {
  if (total === 1) return CENTER;
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    x: CENTER.x + ORBIT_RADIUS * Math.cos(angle),
    y: CENTER.y + ORBIT_RADIUS * Math.sin(angle),
  };
}

function AgentNode({
  agent,
  index,
  total,
  tmuxAvailable,
  onClick,
}: {
  agent: AgentInfo;
  index: number;
  total: number;
  tmuxAvailable: boolean;
  onClick?: () => void;
}) {
  const isActive = agent.status === "active";
  const { x, y } = agentPosition(index, total);
  const clickable = tmuxAvailable && !!onClick;

  const statusColor =
    isActive ? "var(--accent)" : agent.status === "idle" ? "var(--border)" : "var(--text-muted)";

  const label =
    agent.name.length > 12 ? agent.name.slice(0, 11) + "…" : agent.name;

  return (
    <g
      className={clickable ? "agent-clickable" : undefined}
      onClick={clickable ? onClick : undefined}
    >
      {/* Connection line to center (only when multiple agents) */}
      {total > 1 && (
        <line
          x1={CENTER.x}
          y1={CENTER.y}
          x2={x}
          y2={y}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.4}
        />
      )}

      {/* Pulse ring for active agents */}
      {isActive && (
        <circle
          cx={x}
          cy={y}
          r={36}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          opacity={0.35}
          className="pulse-ring"
        />
      )}

      {/* Node circle */}
      <circle
        cx={x}
        cy={y}
        r={26}
        fill="var(--bg-elevated)"
        stroke={statusColor}
        strokeWidth={isActive ? 1.5 : 1}
      />

      {/* Agent name */}
      <text x={x} y={y - 3} textAnchor="middle" className="node-label" fontSize={9}>
        {label}
      </text>

      {/* Agent type */}
      <text x={x} y={y + 9} textAnchor="middle" className="node-role" fontSize={8}>
        {agent.agentType}
      </text>

      {/* Status dot */}
      <circle
        cx={x + 22}
        cy={y - 22}
        r={4}
        fill={statusColor}
        opacity={agent.status === "unknown" ? 0.4 : 1}
      />
    </g>
  );
}

function HubNode({ agentCount }: { agentCount: number }) {
  if (agentCount <= 1) return null;
  return (
    <g>
      <circle cx={CENTER.x} cy={CENTER.y} r={16} fill="var(--bg-surface)" stroke="var(--border)" strokeWidth={1} />
      <text x={CENTER.x} y={CENTER.y + 4} textAnchor="middle" fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono)">
        hub
      </text>
    </g>
  );
}

function TokenPanel({ tokenUsage }: { tokenUsage: SprintState["tokenUsage"] }) {
  if (tokenUsage.total === 0) return null;

  return (
    <div className="token-panel">
      <div className="token-panel-header">Token Cost</div>
      <div className="token-totals">
        <span className="token-cost">${tokenUsage.estimatedCostUsd.toFixed(4)}</span>
        <span className="token-count">{tokenUsage.total.toLocaleString()} tok</span>
      </div>
      <div className="token-bars">
        {Object.entries(tokenUsage.byAgent)
          .sort(([, a], [, b]) => b - a)
          .map(([name, tokens]) => {
            const pct = tokenUsage.total > 0 ? (tokens / tokenUsage.total) * 100 : 0;
            return (
              <div key={name} className="token-bar-row">
                <span className="token-bar-label">{name}</span>
                <div className="token-bar-track">
                  <div className="token-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="token-bar-val">{tokens.toLocaleString()}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function AgentTopology({ agents, tokenUsage, tmuxAvailable, onAgentClick }: AgentTopologyProps) {
  return (
    <div className="panel agents-panel">
      <div className="panel-header">
        <span>Agents</span>
        {agents.length > 0 && (
          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
            {agents.filter((a) => a.status === "active").length} active / {agents.length}
          </span>
        )}
        {tmuxAvailable && (
          <span style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
            click to view terminal
          </span>
        )}
      </div>

      <svg
        className="agents-svg"
        viewBox="0 0 280 360"
        xmlns="http://www.w3.org/2000/svg"
      >
        {agents.length === 0 ? (
          <text x={140} y={180} textAnchor="middle" fontSize={12} fill="var(--text-muted)">
            Waiting for agents...
          </text>
        ) : (
          <>
            <HubNode agentCount={agents.length} />
            {agents.map((agent, i) => (
              <AgentNode
                key={agent.agentId}
                agent={agent}
                index={i}
                total={agents.length}
                tmuxAvailable={tmuxAvailable}
                onClick={onAgentClick ? () => onAgentClick(agent.name) : undefined}
              />
            ))}
          </>
        )}
      </svg>

      <TokenPanel tokenUsage={tokenUsage} />
    </div>
  );
}
