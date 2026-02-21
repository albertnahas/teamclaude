import { basename } from "node:path";
import { state, taskProtocolOverrides, safeReadJSON, broadcast } from "./state.js";
import type { TaskInfo } from "./state.js";

export function handleTaskFile(filePath: string) {
  if (!state.teamName || !filePath.includes(state.teamName)) return;

  const raw = safeReadJSON(filePath) as any;
  if (!raw) return;

  const tasks = Array.isArray(raw) ? raw : [raw];

  for (const t of tasks) {
    if (!t.id) continue;

    const subj = t.subject || t.title || "";
    if (
      subj === "sprint-manager" ||
      subj === "sprint-pm" ||
      subj === "sprint-engineer" ||
      /^sprint-engineer-\d+$/.test(subj)
    )
      continue;

    const task: TaskInfo = {
      id: String(t.id),
      subject: t.subject || t.title || "Untitled",
      status: t.status || "pending",
      owner: t.owner || "",
      blockedBy: t.blockedBy || [],
      description: t.description,
    };

    const override = taskProtocolOverrides.get(task.id);
    if (override) {
      const rank = {
        pending: 0,
        in_progress: 1,
        completed: 2,
        deleted: 3,
      } as const;
      if ((rank[override.status] ?? 0) > (rank[task.status] ?? 0))
        task.status = override.status;
      if (override.owner && !task.owner) task.owner = override.owner;
    }

    const existing = state.tasks.findIndex((x) => x.id === task.id);
    if (existing >= 0) {
      state.tasks[existing] = task;
    } else {
      state.tasks.push(task);
    }

    if (task.status === "completed") {
      state.reviewTaskIds = state.reviewTaskIds.filter(
        (id) => id !== task.id
      );
      // Unblock tasks that depended on this one
      for (const t of state.tasks) {
        if (t.blockedBy.includes(task.id)) {
          t.blockedBy = t.blockedBy.filter((id) => id !== task.id);
          broadcast({ type: "task_updated", task: t });
        }
      }
    }

    broadcast({ type: "task_updated", task });
  }
}
