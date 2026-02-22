import { scoreTaskComplexity, type ComplexityResult } from "./complexity.js";
import type { TaskInfo } from "./state.js";

export interface TaskAnalysis {
  taskId: string;
  complexity: ComplexityResult;
  splitSuggestion: string | null;
  warnings: string[];
}

export interface SprintPlan {
  analyses: TaskAnalysis[];
  suggestedOrder: string[][];
  totalEstimatedComplexity: number;
}

const AGENT_SUBJECT_PATTERN = /^sprint-(manager|engineer(-\d+)?)$/i;

export function isInternalTask(task: TaskInfo): boolean {
  return AGENT_SUBJECT_PATTERN.test(task.subject.trim());
}

// Matches file refs like "server/index.ts", "worktree.ts"
const FILE_REF_RE = /[\w/-]+\.\w{2,4}/g;

// Phrases signalling a task builds on another
const PREREQUISITE_PHRASES = ["from task", "using the", "based on", "built on"];

const STOP_WORDS = new Set(["the", "a", "an", "in", "for", "of", "to", "and", "on", "with", "is", "are", "at", "by"]);

function extractFileRefs(text: string): Set<string> {
  return new Set((text.match(FILE_REF_RE) ?? []).map((f) => f.toLowerCase()));
}

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

export function inferDependencies(tasks: TaskInfo[]): Map<string, string[]> {
  const workTasks = tasks.filter((t) => !isInternalTask(t));
  const result = new Map<string, string[]>();

  // Pre-compute per-task signals
  const fileRefs = new Map<string, Set<string>>();
  const tokens = new Map<string, Set<string>>();
  for (const t of workTasks) {
    const text = [t.subject, t.description ?? ""].join(" ");
    fileRefs.set(t.id, extractFileRefs(text));
    tokens.set(t.id, significantTokens(text));
  }

  for (const task of workTasks) {
    const text = [task.subject, task.description ?? ""].join(" ").toLowerCase();
    const myFiles = fileRefs.get(task.id)!;
    const myTokens = tokens.get(task.id)!;
    const inferred = new Set<string>();

    for (const other of workTasks) {
      if (other.id === task.id) continue;
      // Only consider lower-id tasks as potential upstream deps
      if (Number(other.id) >= Number(task.id)) continue;

      const otherFiles = fileRefs.get(other.id)!;
      const otherTokens = tokens.get(other.id)!;

      // Heuristic 1: shared file paths
      if (myFiles.size > 0 && [...myFiles].some((f) => otherFiles.has(f))) {
        inferred.add(other.id);
        continue;
      }

      // Heuristic 2: prerequisite phrases + keyword overlap
      const hasPhrase = PREREQUISITE_PHRASES.some((p) => text.includes(p));
      if (hasPhrase) {
        const overlap = [...myTokens].filter((tok) => otherTokens.has(tok)).length;
        if (overlap >= 2) {
          inferred.add(other.id);
          continue;
        }
      }

      // Heuristic 3: subject token overlap (2+ shared significant tokens)
      const mySubjectTokens = significantTokens(task.subject);
      const otherSubjectTokens = significantTokens(other.subject);
      const subjectOverlap = [...mySubjectTokens].filter((tok) => otherSubjectTokens.has(tok)).length;
      if (subjectOverlap >= 2) {
        inferred.add(other.id);
      }
    }

    // Only return additions not already in blockedBy
    const existing = new Set(task.blockedBy);
    const additions = [...inferred].filter((id) => !existing.has(id));
    if (additions.length > 0) result.set(task.id, additions);
  }

  return result;
}

export function applyInferredDependencies(
  tasks: TaskInfo[],
  inferred: Map<string, string[]>
): TaskInfo[] {
  return tasks.map((task) => {
    const additions = inferred.get(task.id);
    if (!additions?.length) return task;
    const merged = [...new Set([...task.blockedBy, ...additions])];
    return { ...task, blockedBy: merged };
  });
}

function topoSort(tasks: TaskInfo[]): string[][] {
  const ids = new Set(tasks.map((t) => t.id));
  // remaining = tasks not yet placed in a batch
  const remaining = new Map(tasks.map((t) => [t.id, t]));
  const batches: string[][] = [];

  while (remaining.size > 0) {
    const batch: string[] = [];
    for (const [id, task] of remaining) {
      // A task is ready when all its blockedBy refs are either resolved or unknown
      const allResolved = task.blockedBy.every((dep) => !remaining.has(dep) || !ids.has(dep));
      if (allResolved) batch.push(id);
    }

    if (batch.length === 0) {
      // Cycle detected — dump the rest as a single batch to avoid infinite loop
      batches.push([...remaining.keys()]);
      break;
    }

    for (const id of batch) remaining.delete(id);
    batches.push(batch);
  }

  return batches;
}

// --- Execution plan ---

export interface ExecutionPlan {
  batches: string[][];          // parallel batches in order
  criticalPath: string[];       // longest dependency chain (task IDs)
  timeline: string;             // text-based visualization
}

/**
 * Compute a longest-path critical path through the dependency DAG.
 * Returns the chain of task IDs from first to last with the most hops.
 */
function computeCriticalPath(tasks: TaskInfo[]): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  // dp[id] = { length, prev } where length = longest chain ending at id
  const dp = new Map<string, { length: number; prev: string | null }>();

  function visit(id: string): number {
    const cached = dp.get(id);
    if (cached) return cached.length;

    const task = taskMap.get(id);
    if (!task) { dp.set(id, { length: 1, prev: null }); return 1; }

    let best = 0;
    let bestPrev: string | null = null;
    for (const dep of task.blockedBy) {
      if (!taskMap.has(dep)) continue;
      const depLen = visit(dep);
      if (depLen > best) { best = depLen; bestPrev = dep; }
    }

    dp.set(id, { length: best + 1, prev: bestPrev });
    return best + 1;
  }

  for (const t of tasks) visit(t.id);

  // Find the task with the longest chain
  let tail = "";
  let maxLen = 0;
  for (const [id, { length }] of dp) {
    if (length > maxLen) { maxLen = length; tail = id; }
  }

  // Reconstruct path
  const path: string[] = [];
  let cur: string | null = tail;
  while (cur) {
    path.unshift(cur);
    cur = dp.get(cur)?.prev ?? null;
  }
  return path;
}

function renderTimeline(batches: string[][]): string {
  return batches
    .map((batch, i) => {
      const label = batch.length > 1 ? "parallel" : "sequential";
      return `Batch ${i + 1} (${label}): ${batch.map((id) => `#${id}`).join(", ")}`;
    })
    .join("\n");
}

export function buildExecutionPlan(tasks: TaskInfo[]): ExecutionPlan {
  const workTasks = tasks.filter((t) => !isInternalTask(t));
  const batches = topoSort(workTasks);
  const criticalPath = computeCriticalPath(workTasks);
  const timeline = renderTimeline(batches);
  return { batches, criticalPath, timeline };
}

export function recommendEngineers(plan: ExecutionPlan, maxEngineers = 5): number {
  if (plan.batches.length === 0) return 1;
  const maxParallel = Math.max(...plan.batches.map((b) => b.length));
  return Math.min(Math.max(1, maxParallel), maxEngineers);
}

export function analyzeSprintTasks(tasks: TaskInfo[]): SprintPlan {
  const workTasks = tasks.filter((t) => !isInternalTask(t));

  const analyses: TaskAnalysis[] = workTasks.map((task) => {
    const complexity = scoreTaskComplexity(task);
    const warnings: string[] = [];

    if (!task.description) warnings.push("no description");
    if (complexity.tier === "complex") warnings.push("very high complexity");

    const splitSuggestion =
      complexity.score >= 8 && task.blockedBy.length === 0
        ? "Consider splitting: high complexity task with no sub-tasks"
        : null;

    return { taskId: task.id, complexity, splitSuggestion, warnings };
  });

  const suggestedOrder = topoSort(workTasks);
  const totalEstimatedComplexity = analyses.reduce(
    (sum, a) => sum + a.complexity.score,
    0
  );

  return { analyses, suggestedOrder, totalEstimatedComplexity };
}
