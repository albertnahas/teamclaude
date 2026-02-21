import type { SprintState, TaskInfo } from "./state.js";
import type { SprintRecord } from "./analytics.js";

// --- Helpers ---

function fmt(date: string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function duration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function reviewRoundsForTask(taskId: string, state: SprintState): number {
  return state.messages.filter(
    (m) => m.protocol === "RESUBMIT" && m.content.includes(`#${taskId}`)
  ).length;
}

function statusLabel(task: TaskInfo): string {
  if (task.status === "completed") return "Done";
  if (task.status === "in_progress") return "In Progress";
  if (task.status === "deleted") return "Deleted";
  return "Pending";
}

// --- Sections ---

function sprintSummarySection(
  state: SprintState,
  record: SprintRecord | undefined
): string {
  const lines = [
    "## Sprint Summary",
    "",
    `- **Team:** ${state.teamName ?? "—"}`,
    `- **Project:** ${state.projectName ?? "—"}`,
    `- **Cycle:** ${state.cycle}`,
    `- **Phase:** ${state.phase}`,
    `- **Mode:** ${state.mode}`,
  ];

  if (record) {
    lines.push(`- **Date:** ${fmt(record.completedAt)}`);
    lines.push(`- **Duration:** ${duration(record.startedAt, record.completedAt)}`);
  } else {
    lines.push(`- **Date:** ${fmt(new Date().toISOString())}`);
  }

  return lines.join("\n");
}

function taskResultsSection(state: SprintState): string {
  const visible = state.tasks.filter((t) => t.status !== "deleted");

  if (!visible.length) {
    return "## Task Results\n\n_No tasks were created in this sprint._";
  }

  const header = "| # | Task | Status | Owner | Review Rounds |";
  const divider = "|---|------|--------|-------|---------------|";
  const rows = visible.map((t) => {
    const rounds = reviewRoundsForTask(t.id, state);
    return `| #${t.id} | ${t.subject} | ${statusLabel(t)} | ${t.owner || "—"} | ${rounds} |`;
  });

  return ["## Task Results", "", header, divider, ...rows].join("\n");
}

function teamPerformanceSection(state: SprintState): string {
  const visible = state.tasks.filter((t) => t.status !== "deleted");
  const completed = visible.filter((t) => t.status === "completed").length;
  const completionRate =
    visible.length > 0
      ? Math.round((completed / visible.length) * 100)
      : 0;

  const completedTasks = visible.filter((t) => t.status === "completed");
  const totalRounds = completedTasks.reduce(
    (sum, t) => sum + reviewRoundsForTask(t.id, state),
    0
  );
  const avgRounds =
    completedTasks.length > 0
      ? (totalRounds / completedTasks.length).toFixed(2)
      : "0.00";

  // Messages per agent pair
  const pairCounts = new Map<string, number>();
  for (const m of state.messages) {
    if (m.from === "system") continue;
    const key = `${m.from} → ${m.to}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  const pairLines =
    pairCounts.size > 0
      ? [...pairCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([pair, count]) => `  - ${pair}: ${count}`)
          .join("\n")
      : "  _No inter-agent messages_";

  return [
    "## Team Performance",
    "",
    `- **Completion rate:** ${completionRate}% (${completed}/${visible.length} tasks)`,
    `- **Avg review rounds per task:** ${avgRounds}`,
    `- **Total messages:** ${state.messages.length}`,
    "",
    "**Message flow:**",
    pairLines,
  ].join("\n");
}

function velocityTrendSection(
  state: SprintState,
  history: SprintRecord[]
): string {
  const teamHistory = history
    .filter((r) => {
      // Match by team name embedded in sprintId (format: "teamName-timestamp")
      const team = state.teamName ?? "";
      return team && r.sprintId.startsWith(team + "-");
    })
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

  if (teamHistory.length < 2) return "";

  const last = teamHistory[teamHistory.length - 1];
  const prev = teamHistory[teamHistory.length - 2];

  const lastRate =
    last.totalTasks > 0
      ? Math.round((last.completedTasks / last.totalTasks) * 100)
      : 0;
  const prevRate =
    prev.totalTasks > 0
      ? Math.round((prev.completedTasks / prev.totalTasks) * 100)
      : 0;

  const delta = lastRate - prevRate;
  const sign = delta >= 0 ? "+" : "";
  const trend = delta === 0 ? "no change" : `${sign}${delta}% from last cycle`;

  return [
    "## Velocity Trend",
    "",
    `- **This cycle:** ${lastRate}% completion rate`,
    `- **Previous cycle:** ${prevRate}% completion rate`,
    `- **Trend:** ${trend}`,
  ].join("\n");
}

function agentActivitySection(state: SprintState): string {
  const counts = new Map<string, { sent: number; received: number }>();

  for (const m of state.messages) {
    if (m.from !== "system") {
      const s = counts.get(m.from) ?? { sent: 0, received: 0 };
      s.sent++;
      counts.set(m.from, s);
    }
    if (m.to !== "system" && m.to !== "all") {
      const r = counts.get(m.to) ?? { sent: 0, received: 0 };
      r.received++;
      counts.set(m.to, r);
    }
  }

  if (!counts.size) {
    return "## Agent Activity\n\n_No agent messages recorded._";
  }

  const header = "| Agent | Sent | Received | Total |";
  const divider = "|-------|------|----------|-------|";
  const rows = [...counts.entries()]
    .sort((a, b) => b[1].sent + b[1].received - (a[1].sent + a[1].received))
    .map(([agent, { sent, received }]) =>
      `| ${agent} | ${sent} | ${received} | ${sent + received} |`
    );

  return ["## Agent Activity", "", header, divider, ...rows].join("\n");
}

// --- Structured export ---

export interface RetroJSON {
  summary: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    avgReviewRounds: number;
  };
  completed: string[];
  incomplete: string[];
  highlights: string[];
  recommendations: string[];
  raw: string;
}

/**
 * Parse a retro markdown string (generated by generateRetro) into structured JSON.
 * Fields are extracted via regex from the known section headings.
 */
export function parseRetro(markdown: string): RetroJSON {
  // Extract numbers from Team Performance section
  const completionMatch = markdown.match(/\*\*Completion rate:\*\*\s*(\d+)%\s*\((\d+)\/(\d+)/);
  const completedTasks = completionMatch ? parseInt(completionMatch[2], 10) : 0;
  const totalTasks = completionMatch ? parseInt(completionMatch[3], 10) : 0;
  const completionRate = completionMatch ? parseInt(completionMatch[1], 10) : 0;

  const avgMatch = markdown.match(/\*\*Avg review rounds per task:\*\*\s*([\d.]+)/);
  const avgReviewRounds = avgMatch ? parseFloat(avgMatch[1]) : 0;

  // Extract task names from the Task Results table
  const completed: string[] = [];
  const incomplete: string[] = [];

  // Match table rows: | #id | subject | status | ...
  const rowRe = /\|\s*#\d+\s*\|\s*([^|]+?)\s*\|\s*(Done|In Progress|Pending|Deleted)\s*\|/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(markdown)) !== null) {
    const subject = match[1].trim();
    const status = match[2].trim();
    if (status === "Done") {
      completed.push(subject);
    } else if (status === "In Progress" || status === "Pending") {
      incomplete.push(subject);
    }
  }

  // highlights: completed task names (what went well — tasks shipped)
  const highlights = completed.slice();

  // recommendations: incomplete tasks (what didn't finish — needs follow-up)
  const recommendations = incomplete.slice();

  return {
    summary: { totalTasks, completedTasks, completionRate, avgReviewRounds },
    completed,
    incomplete,
    highlights,
    recommendations,
    raw: markdown,
  };
}

// --- Public API ---

export function generateRetro(
  state: SprintState,
  history: SprintRecord[]
): string {
  // Find the most recent record for this team (just recorded)
  const teamName = state.teamName ?? "";
  const record = [...history]
    .reverse()
    .find((r) => teamName && r.sprintId.startsWith(teamName + "-"));

  const sections = [
    `# Sprint Retrospective`,
    "",
    sprintSummarySection(state, record),
    "",
    taskResultsSection(state),
    "",
    teamPerformanceSection(state),
  ];

  const velocity = velocityTrendSection(state, history);
  if (velocity) {
    sections.push("", velocity);
  }

  sections.push("", agentActivitySection(state));

  return sections.join("\n");
}
