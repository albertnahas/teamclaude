import type { SprintState } from "../types";

interface EscalationBarProps {
  escalation: SprintState["escalation"];
  onDismiss: () => void;
}

export function EscalationBar({ escalation, onDismiss }: EscalationBarProps) {
  if (!escalation) return null;

  return (
    <div className="escalation-bar">
      <span className="escalation-icon">⚠</span>
      <span className="escalation-text">
        <strong>{escalation.from}</strong> escalated task #{escalation.taskId}: {escalation.reason}
      </span>
      <button className="escalation-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
