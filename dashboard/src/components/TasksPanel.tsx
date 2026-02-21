import { useEffect, useState } from "react";
import type { TaskInfo, ModelRoutingDecision } from "../types";
import { MODEL_LABEL } from "../types";

interface TasksPanelProps {
  tasks: TaskInfo[];
  reviewTaskIds: string[];
}

const STATUS_COLORS: Record<TaskInfo["status"], string> = {
  pending: "var(--text-muted)",
  in_progress: "var(--amber)",
  completed: "var(--green)",
  deleted: "var(--red)",
};

const TIER_COLOR: Record<"simple" | "medium" | "complex", string> = {
  simple: "var(--green)",
  medium: "var(--amber)",
  complex: "var(--purple)",
};

const KANBAN_COLS = [
  { key: "pending", label: "Todo", color: "var(--text-muted)" },
  { key: "in_progress", label: "In Progress", color: "var(--amber)" },
  { key: "review", label: "Review", color: "var(--blue)" },
  { key: "completed", label: "Done", color: "var(--green)" },
] as const;

// Cost per 1K tokens
const MODEL_INPUT_PER_1K: Record<string, number> = {
  "claude-haiku-4-5-20251001": 0.0008,
  "claude-sonnet-4-6": 0.008,
  "claude-opus-4-6": 0.08,
};
const OPUS_INPUT_PER_1K = 0.08;
const AVG_TOKENS_PER_TASK = 2000;

function ModelBadge({ decision }: { decision: ModelRoutingDecision }) {
  const label = MODEL_LABEL[decision.model] ?? decision.model.split("-")[1] ?? decision.model;
  return (
    <span
      title={`${decision.model} (score: ${decision.score}, ${decision.reason})`}
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        padding: "1px 5px",
        borderRadius: 3,
        color: TIER_COLOR[decision.tier],
        border: `1px solid ${TIER_COLOR[decision.tier]}`,
        opacity: 0.85,
        flexShrink: 0,
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  );
}

function CostSummary({
  tasks,
  taskModels,
}: {
  tasks: TaskInfo[];
  taskModels: Record<string, ModelRoutingDecision>;
}) {
  if (tasks.length === 0 || Object.keys(taskModels).length === 0) return null;

  const counts: Record<string, number> = {};
  let routedCost = 0;
  for (const task of tasks) {
    const m = taskModels[task.id]?.model ?? "claude-sonnet-4-6";
    counts[m] = (counts[m] ?? 0) + 1;
    routedCost += AVG_TOKENS_PER_TASK * (MODEL_INPUT_PER_1K[m] ?? MODEL_INPUT_PER_1K["claude-sonnet-4-6"]) / 1000;
  }

  const opusCost = tasks.length * AVG_TOKENS_PER_TASK * OPUS_INPUT_PER_1K / 1000;
  const saved = opusCost - routedCost;
  const pct = opusCost > 0 ? Math.round((saved / opusCost) * 100) : 0;

  return (
    <div
      style={{
        padding: "8px 12px",
        borderTop: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
      }}
    >
      {Object.entries(counts).map(([model, count]) => {
        const lbl = MODEL_LABEL[model];
        const color =
          lbl === "Haiku" ? "var(--green)" : lbl === "Opus" ? "var(--purple)" : "var(--amber)";
        return (
          <span key={model} style={{ color: "var(--text-secondary)" }}>
            <span style={{ color }}>{lbl ?? model}</span> x{count}
          </span>
        );
      })}
      {saved > 0 && (
        <span style={{ marginLeft: "auto", color: "var(--green)" }}>
          ~{pct}% saved vs all-Opus
        </span>
      )}
    </div>
  );
}

function TaskRow({
  task,
  isReview,
  decision,
  completedIds,
}: {
  task: TaskInfo;
  isReview: boolean;
  decision?: ModelRoutingDecision;
  completedIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const unresolvedBlockers = task.blockedBy.filter((id) => !completedIds.has(id));

  return (
    <div
      className={`task-row ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <span className="task-id">#{task.id}</span>
      <span
        className="status-badge"
        style={{ background: isReview ? "var(--blue)" : STATUS_COLORS[task.status] }}
      />
      <span className="task-subject">{task.subject}</span>
      {unresolvedBlockers.length > 0 && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--red)" }}>
          blocked
        </span>
      )}
      {decision && <ModelBadge decision={decision} />}
      <span className="task-owner">{task.owner}</span>
      <span className="task-chevron">▶</span>
      {expanded && task.description && (
        <div className="task-desc">{task.description}</div>
      )}
    </div>
  );
}

function KanbanCard({
  task,
  isReview,
  decision,
  completedIds,
}: {
  task: TaskInfo;
  isReview: boolean;
  decision?: ModelRoutingDecision;
  completedIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const colClass = isReview
    ? "col-review"
    : task.status === "pending"
      ? "col-todo"
      : task.status === "in_progress"
        ? "col-progress"
        : task.status === "completed"
          ? "col-done"
          : "";
  const unresolvedBlockers = task.blockedBy.filter((id) => !completedIds.has(id));

  return (
    <div
      className={`kanban-card ${colClass} ${expanded ? "expanded" : ""} ${unresolvedBlockers.length ? "blocked" : ""}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="card-top">
        <span className="card-id">#{task.id}</span>
        {unresolvedBlockers.length > 0 && <span className="card-blocked">blocked</span>}
        {decision && <ModelBadge decision={decision} />}
      </div>
      <div className="card-subject">{task.subject}</div>
      {task.owner && <div className="card-owner">{task.owner}</div>}
      {expanded && task.description && (
        <div className="card-desc">{task.description}</div>
      )}
    </div>
  );
}

export function TasksPanel({ tasks, reviewTaskIds }: TasksPanelProps) {
  const [view, setView] = useState<"list" | "board">("list");
  const [taskModels, setTaskModels] = useState<Record<string, ModelRoutingDecision>>({});
  const reviewSet = new Set(reviewTaskIds);
  const visible = tasks.filter((t) => t.status !== "deleted");
  const completedIds = new Set(visible.filter((t) => t.status === "completed").map((t) => t.id));
  const done = completedIds.size;

  useEffect(() => {
    if (tasks.length === 0) return;
    fetch("/api/task-models")
      .then((r) => r.json())
      .then((data) => setTaskModels(data as Record<string, ModelRoutingDecision>))
      .catch(() => {});
  }, [tasks.length]);

  return (
    <div className="panel tasks-panel" style={{ display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span>Tasks</span>
        {visible.length > 0 && (
          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
            {done}/{visible.length}
          </span>
        )}
        <button
          className="view-toggle"
          onClick={() => setView((v) => (v === "list" ? "board" : "list"))}
        >
          {view === "list" ? "Board" : "List"}
        </button>
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {view === "list" ? (
          <div className="tasks-list">
            {visible.length === 0 ? (
              <div className="empty-state">Waiting for sprint to start...</div>
            ) : (
              visible.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isReview={reviewSet.has(task.id)}
                  decision={taskModels[task.id]}
                  completedIds={completedIds}
                />
              ))
            )}
          </div>
        ) : (
          <div className="tasks-list board">
            {KANBAN_COLS.map((col) => {
              const colTasks =
                col.key === "review"
                  ? visible.filter((t) => reviewSet.has(t.id))
                  : visible.filter((t) => t.status === col.key && !reviewSet.has(t.id));
              return (
                <div key={col.key} className="kanban-col">
                  <div className="kanban-hdr">
                    <span className="kanban-dot" style={{ background: col.color }} />
                    {col.label}
                    <span className="kanban-count">{colTasks.length}</span>
                  </div>
                  <div className="kanban-body">
                    {colTasks.map((task) => (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        isReview={reviewSet.has(task.id)}
                        decision={taskModels[task.id]}
                        completedIds={completedIds}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CostSummary tasks={visible} taskModels={taskModels} />
    </div>
  );
}
