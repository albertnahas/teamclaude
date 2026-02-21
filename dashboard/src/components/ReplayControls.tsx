import { useState } from "react";

interface ReplayControlsProps {
  totalEvents: number;
  currentEvent: number;
  speed: number;
  complete: boolean;
  onSpeedChange: (speed: number) => void;
  onRestart: () => void;
}

const SPEEDS = [1, 2, 5, 10];

export function ReplayControls({
  totalEvents,
  currentEvent,
  speed,
  complete,
  onSpeedChange,
  onRestart,
}: ReplayControlsProps) {
  const [changing, setChanging] = useState(false);

  async function handleSpeedChange(newSpeed: number) {
    setChanging(true);
    try {
      await fetch("/api/replay/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed: newSpeed }),
      });
      onSpeedChange(newSpeed);
    } catch {
      // Fire-and-forget; speed update best-effort
    } finally {
      setChanging(false);
    }
  }

  const pct = totalEvents > 0 ? Math.round((currentEvent / totalEvents) * 100) : 0;

  return (
    <div className="replay-controls">
      <span className="replay-label">
        {complete ? "Replay complete" : "Replaying sprint..."}
      </span>

      <div className="replay-progress">
        <div className="replay-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="replay-progress-text">
        {currentEvent}/{totalEvents} events
      </span>

      <div className="replay-speeds">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`replay-speed-btn ${speed === s ? "active" : ""}`}
            onClick={() => handleSpeedChange(s)}
            disabled={changing || complete}
            title={`${s}x speed`}
          >
            {s}x
          </button>
        ))}
      </div>

      {complete && (
        <button className="replay-restart-btn" onClick={onRestart}>
          Restart
        </button>
      )}
    </div>
  );
}
