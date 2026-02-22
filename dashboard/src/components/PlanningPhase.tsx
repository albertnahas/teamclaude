import { useEffect, useState } from "react";
import type { Theme } from "../hooks/useTheme";

interface ComplexityResult {
  score: number;
  tier: "simple" | "medium" | "complex";
  reason: string;
}

interface TaskAnalysis {
  taskId: string;
  complexity: ComplexityResult;
  splitSuggestion: string | null;
  warnings: string[];
}

interface SprintPlan {
  analyses: TaskAnalysis[];
  suggestedOrder: string[][];
  totalEstimatedComplexity: number;
}

interface ExecutionPlan {
  batches: string[][];
  criticalPath: string[];
  timeline: string;
}

interface ModelDecision {
  model: string;
  tier: "simple" | "medium" | "complex";
  score: number;
  reason: string;
}

interface PlanData {
  sprintPlan: SprintPlan;
  executionPlan: ExecutionPlan;
  modelRouting: Record<string, ModelDecision>;
  recommendedEngineers: number;
}

interface PlanningPhaseProps {
  onApprove: () => void;
  onReject: () => void;
  onUpdateEngineers?: (n: number) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const TIER_COLOR: Record<string, string> = {
  simple: "var(--green)",
  medium: "var(--amber)",
  complex: "var(--red)",
};

function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

export function PlanningPhase({ onApprove, onReject, onUpdateEngineers, theme, onToggleTheme }: PlanningPhaseProps) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plan")
      .then((r) => r.json())
      .then((data) => {
        const d = data as PlanData;
        setPlan(d);
        if (d.recommendedEngineers > 1) onUpdateEngineers?.(d.recommendedEngineers);
      })
      .catch(() => setError("Failed to load plan"));
  }, []);

  const handleApprove = async () => {
    await fetch("/api/plan/approve", { method: "POST" });
    onApprove();
  };

  const handleSkip = () => onApprove();

  if (error) {
    return (
      <div className="planning-phase">
        <div className="planning-error">{error}</div>
        <div className="planning-actions">
          <button className="reject-btn" onClick={onReject}>Back</button>
          <button className="approve-btn" onClick={handleSkip}>Skip Planning</button>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="planning-phase">
        <div className="planning-loading">Analyzing tasks...</div>
      </div>
    );
  }

  const { sprintPlan, executionPlan, modelRouting } = plan;
  const cpSet = new Set(executionPlan.criticalPath);

  return (
    <div className="planning-phase">
      <div className="planning-header">
        <span className="planning-title">Pre-Sprint Analysis</span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          style={{ marginLeft: "auto", marginRight: "8px" }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <span className="planning-meta">
          {sprintPlan.analyses.length} tasks &middot; complexity{" "}
          <strong>{sprintPlan.totalEstimatedComplexity}</strong>
          {plan.recommendedEngineers > 1 && (
            <> &middot; recommended <strong>{plan.recommendedEngineers}</strong> engineers</>
          )}
        </span>
      </div>

      <div className="planning-body">
        <div className="planning-section">
          <div className="section-label">Task Plan</div>
          <div className="plan-table">
            <div className="plan-table-header">
              <span>ID</span>
              <span>Tier</span>
              <span>Score</span>
              <span>Model</span>
              <span>Notes</span>
            </div>
            {sprintPlan.analyses.map((a) => {
              const routing = modelRouting[a.taskId];
              return (
                <div
                  key={a.taskId}
                  className={`plan-table-row ${cpSet.has(a.taskId) ? "critical" : ""}`}
                >
                  <span className="ta-id">#{a.taskId}</span>
                  <span className="ta-tier" style={{ color: TIER_COLOR[a.complexity.tier] }}>
                    {a.complexity.tier}
                  </span>
                  <span className="ta-score">{a.complexity.score}/10</span>
                  <span className="ta-model">{routing ? shortModel(routing.model) : "—"}</span>
                  <span className="ta-notes">
                    {cpSet.has(a.taskId) && <span className="ta-critical">critical</span>}
                    {a.splitSuggestion && <span className="ta-split">split?</span>}
                    {a.warnings.map((w) => (
                      <span key={w} className="ta-warning">{w}</span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="planning-section">
          <div className="section-label">Execution Order</div>
          <pre className="planning-timeline">{executionPlan.timeline}</pre>
        </div>
      </div>

      <div className="planning-actions">
        <button className="reject-btn" onClick={onReject}>
          Back to Setup
        </button>
        <button className="skip-btn" onClick={handleSkip}>
          Skip Planning
        </button>
        <button className="approve-btn" onClick={handleApprove}>
          Approve Plan
        </button>
      </div>
    </div>
  );
}
