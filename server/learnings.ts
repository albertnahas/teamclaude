import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { learningsPath, ensureStorageDir } from "./storage.js";
import type { SprintState } from "./state.js";
import type { SprintRecord } from "./analytics.js";

export function loadLearnings(): string {
  const path = learningsPath();
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function appendLearnings(
  state: SprintState,
  record: SprintRecord,
  retro: string
): void {
  ensureStorageDir();

  const completed = state.tasks.filter((t) => t.status === "completed");
  const incomplete = state.tasks.filter(
    (t) => t.status !== "completed" && t.status !== "deleted"
  );
  const escalations = state.messages.filter(
    (m) => m.protocol === "ESCALATION"
  );

  const lines: string[] = [
    "",
    `## Sprint ${record.sprintId}`,
    `_${record.completedAt}_`,
    "",
    `**Completion:** ${record.completedTasks}/${record.totalTasks} tasks | **Avg review rounds:** ${record.avgReviewRoundsPerTask}`,
    "",
  ];

  if (completed.length > 0) {
    lines.push("### Completed");
    for (const t of completed) lines.push(`- ${t.subject}`);
    lines.push("");
  }

  if (incomplete.length > 0) {
    lines.push("### Incomplete");
    for (const t of incomplete) lines.push(`- ${t.subject} (${t.status})`);
    lines.push("");
  }

  if (escalations.length > 0) {
    lines.push("### Escalations");
    for (const m of escalations) lines.push(`- ${m.from}: ${m.content}`);
    lines.push("");
  }

  const path = learningsPath();
  if (!existsSync(path)) {
    writeFileSync(path, `# Sprint Learnings\n${lines.join("\n")}`, "utf-8");
  } else {
    appendFileSync(path, lines.join("\n"), "utf-8");
  }
}

export function getRecentLearnings(count: number = 3): string {
  const content = loadLearnings();
  if (!content) return "";

  const sections = content.split(/(?=^## Sprint )/m);
  // First section is the header ("# Sprint Learnings\n"), skip it
  const sprintSections = sections.filter((s) => s.startsWith("## Sprint "));
  if (sprintSections.length === 0) return "";

  return sprintSections.slice(-count).join("\n").trim();
}
