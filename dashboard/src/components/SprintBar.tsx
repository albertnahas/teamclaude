import type { SprintState } from "../types";
import type { Theme } from "../hooks/useTheme";

interface SprintBarProps {
  state: SprintState;
  theme: Theme;
  onPause: () => void;
  onStop: () => void;
  onToggleTheme: () => void;
  onShowShortcuts?: () => void;
}

export function SprintBar({ state, theme, onPause, onStop, onToggleTheme, onShowShortcuts }: SprintBarProps) {
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
      <span className="sprint-bar-spacer" />
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
