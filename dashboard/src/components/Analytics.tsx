import { Fragment, useEffect, useState } from "react";
import type { SprintState, ModelRoutingDecision } from "../types";
import { RetroExport } from "./RetroExport";
import { MODEL_COST } from "../types";

interface SprintRecord {
  sprintId: string;
  completedAt: number;
  cycle: number;
  completedTasks: number;
  totalTasks: number;
  avgReviewRoundsPerTask: number;
  totalMessages: number;
  agents?: string[];
}

interface AnalyticsProps {
  /** Live stats from current sprint */
  tasks: SprintState["tasks"];
  tokenUsage: SprintState["tokenUsage"];
  messages: SprintState["messages"];
  cycle: number;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="analytics-stat">
      <div className="analytics-stat-value">{value}</div>
      <div className="analytics-stat-label">{label}</div>
      {sub && <div className="analytics-stat-sub">{sub}</div>}
    </div>
  );
}

function HistoryTable({ records }: { records: SprintRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (records.length === 0) {
    return <div className="empty-state">No sprint history yet</div>;
  }

  return (
    <table className="history-table">
      <thead>
        <tr>
          <th>Sprint ID</th>
          <th>Date</th>
          <th>Cycle</th>
          <th>Tasks</th>
          <th>Avg Review Rounds</th>
          <th>Messages</th>
        </tr>
      </thead>
      <tbody>
        {[...records].reverse().map((r) => {
          const date = new Date(r.completedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          const expanded = expandedId === r.sprintId;

          return (
            <Fragment key={r.sprintId}>
              <tr
                className={`history-data-row ${expanded ? "expanded" : ""}`}
                onClick={() => setExpandedId(expanded ? null : r.sprintId)}
              >
                <td>
                  <span className="history-sprint-id">{r.sprintId}</span>
                </td>
                <td>{date}</td>
                <td>{r.cycle}</td>
                <td>
                  <span className="history-tasks-bar">
                    <span className="done">{r.completedTasks}</span>
                    <span className="sep">/</span>
                    <span className="total">{r.totalTasks}</span>
                  </span>
                </td>
                <td>{r.avgReviewRoundsPerTask}</td>
                <td>{r.totalMessages}</td>
              </tr>
              {expanded && (
                <tr className="history-detail-row">
                  <td colSpan={6}>
                    <div className="history-detail-inner">
                      <div className="history-detail-label">Agents</div>
                      <div className="history-agents">
                        {r.agents && r.agents.length > 0
                          ? r.agents.map((a) => (
                              <span key={a} className="history-agent-tag">
                                {a}
                              </span>
                            ))
                          : "—"}
                      </div>
                      <RetroExport retroAvailable sprintId={r.sprintId} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// Average tokens assumed per task for routing savings estimate
const AVG_TOKENS_PER_TASK = 5_000;
const OPUS_MODEL = "claude-opus-4-6";

function computeRoutingSavings(
  tasks: SprintState["tasks"],
  taskModels: Record<string, ModelRoutingDecision>
): { savedUsd: number; savedPct: number } | null {
  const visible = tasks.filter((t) => t.status !== "deleted");
  if (visible.length === 0 || Object.keys(taskModels).length === 0) return null;

  const opusInputCostPerToken = (MODEL_COST[OPUS_MODEL]?.input ?? 15) / 1_000_000;
  const baselineCost = visible.length * AVG_TOKENS_PER_TASK * opusInputCostPerToken;

  let routedCost = 0;
  for (const task of visible) {
    const model = taskModels[task.id]?.model ?? OPUS_MODEL;
    const costPerToken = (MODEL_COST[model]?.input ?? MODEL_COST[OPUS_MODEL].input) / 1_000_000;
    routedCost += AVG_TOKENS_PER_TASK * costPerToken;
  }

  const savedUsd = baselineCost - routedCost;
  const savedPct = baselineCost > 0 ? Math.round((savedUsd / baselineCost) * 100) : 0;
  return { savedUsd, savedPct };
}

export function Analytics({ tasks, tokenUsage, messages, cycle }: AnalyticsProps) {
  const [records, setRecords] = useState<SprintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskModels, setTaskModels] = useState<Record<string, ModelRoutingDecision>>({});

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((data: SprintRecord[]) => setRecords(data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tasks.length === 0) return;
    fetch("/api/task-models")
      .then((r) => r.json())
      .then((data) => setTaskModels(data as Record<string, ModelRoutingDecision>))
      .catch(() => {});
  }, [tasks.length]);

  const visible = tasks.filter((t) => t.status !== "deleted");
  const completed = visible.filter((t) => t.status === "completed").length;
  const inProgress = visible.filter((t) => t.status === "in_progress").length;
  const completionRate =
    visible.length > 0 ? Math.round((completed / visible.length) * 100) : 0;

  const savings = computeRoutingSavings(tasks, taskModels);

  return (
    <div className="analytics-panel">
      <div className="analytics-live">
        <div className="analytics-section-label">Live Sprint</div>
        <div className="analytics-stats">
          <StatCard
            label="Completion"
            value={`${completionRate}%`}
            sub={`${completed}/${visible.length} tasks`}
          />
          <StatCard
            label="In Progress"
            value={String(inProgress)}
            sub="active tasks"
          />
          <StatCard
            label="Token Cost"
            value={`$${tokenUsage.estimatedCostUsd.toFixed(4)}`}
            sub={`${tokenUsage.total.toLocaleString()} tokens`}
          />
          <StatCard
            label="Messages"
            value={String(messages.length)}
            sub={cycle > 0 ? `cycle ${cycle}` : ""}
          />
          {savings !== null && (
            <StatCard
              label="Routing Savings"
              value={savings.savedPct > 0 ? `${savings.savedPct}%` : "—"}
              sub={savings.savedUsd > 0 ? `$${savings.savedUsd.toFixed(4)} vs all-Opus` : "no savings"}
            />
          )}
        </div>
      </div>

      <div className="analytics-history">
        <div className="analytics-section-label">Sprint History</div>
        <div className="history-table-wrap">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : (
            <HistoryTable records={records} />
          )}
        </div>
      </div>
    </div>
  );
}
