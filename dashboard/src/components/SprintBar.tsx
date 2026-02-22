import type { SprintState } from "../types";
import type { Theme } from "../hooks/useTheme";

interface SprintBarProps {
  state: SprintState;
  theme: Theme;
  onPause: () => void;
  onStop: () => void;
  onToggleTheme: () => void;
  onShowShortcuts?: () => void;
  onShowMemory?: () => void;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function BudgetBar({ state }: { state: SprintState }) {
  const { tokenUsage, tokenBudgetApproaching, tokenBudgetExceeded, tokenBudgetConfig } = state;

  // Only show when budget is tracked (config present or budget flags fired)
  const hasBudget = tokenBudgetConfig || tokenBudgetApproaching || tokenBudgetExceeded;
  if (!hasBudget && tokenUsage.total === 0) return null;
  if (!hasBudget) return null;

  const colorClass = tokenBudgetExceeded
    ? "budget-bar-fill--exceeded"
    : tokenBudgetApproaching
      ? "budget-bar-fill--approaching"
      : "budget-bar-fill--ok";

  let pct = 0;
  if (tokenBudgetConfig?.tokens) {
    pct = Math.min(100, (tokenUsage.total / tokenBudgetConfig.tokens) * 100);
  } else if (tokenBudgetConfig?.usd) {
    pct = Math.min(100, (tokenUsage.estimatedCostUsd / tokenBudgetConfig.usd) * 100);
  } else if (tokenBudgetExceeded) {
    pct = 100;
  } else if (tokenBudgetApproaching) {
    pct = 85; // mid-point in the approaching range
  }

  const maxLabel = tokenBudgetConfig?.tokens
    ? ` / ${fmt(tokenBudgetConfig.tokens)}`
    : tokenBudgetConfig?.usd
      ? ` / $${tokenBudgetConfig.usd.toFixed(2)}`
      : "";

  return (
    <div className="budget-bar-wrap">
      <div className="budget-bar-track">
        <div className={`budget-bar-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="budget-bar-text">
        {fmt(tokenUsage.total)}{maxLabel}
        {" · "}
        ${tokenUsage.estimatedCostUsd.toFixed(2)}
      </span>
    </div>
  );
}

export function SprintBar({ state, theme, onPause, onStop, onToggleTheme, onShowShortcuts, onShowMemory }: SprintBarProps) {
  const cycleLabel =
    state.cycle > 0
      ? `Cycle ${state.cycle} · ${state.phase}`
      : state.phase !== "idle"
        ? state.phase
        : "";

  return (
    <div className="sprint-bar">
      <span className="sprint-bar-title">Sprint</span>
      {state.projectName && (
        <span className="sprint-bar-project">{state.projectName}</span>
      )}
      {state.teamName && (
        <span className="sprint-bar-team">{state.teamName}</span>
      )}
      <span className="sprint-bar-mode">{state.mode}</span>
      <span className="sprint-bar-sep" />
      {cycleLabel && <span className="sprint-bar-cycle">{cycleLabel}</span>}
      <BudgetBar state={state} />
      <span className="sprint-bar-spacer" />
      {onShowMemory && (
        <button
          className="theme-toggle"
          onClick={onShowMemory}
          title="Agent memories"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          mem
        </button>
      )}
      {onShowShortcuts && (
        <button
          className="theme-toggle"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts (?)"
          style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
        >
          ?
        </button>
      )}
      <button
        className="theme-toggle"
        onClick={onToggleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <button className="pause-btn" onClick={onPause}>
        {state.paused ? "Resume" : "Pause"}
      </button>
      <button className="stop-btn" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
