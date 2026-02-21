import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SprintState, TaskInfo } from "./state.js";

// --- Types ---

export interface GitHubConfig {
  repo: string;   // "owner/repo"
  token: string;  // GitHub personal access token
  prNumber?: number; // PR to comment on (optional; skips PR comment if absent)
}

// --- Config parsing ---

/**
 * Load GitHub config from .sprint.yml github section + env fallback.
 * Returns null if not configured.
 */
export function loadGitHubConfig(cwd: string = process.cwd()): GitHubConfig | null {
  const sprintYml = join(cwd, ".sprint.yml");
  let repo: string | null = null;
  let prNumber: number | undefined;

  if (existsSync(sprintYml)) {
    let raw: string;
    try {
      raw = readFileSync(sprintYml, "utf-8");
    } catch {
      return null;
    }

    const sectionMatch = raw.match(/^github\s*:\s*\n((?:[ \t]+\S[^\n]*\n?)*)/m);
    if (sectionMatch) {
      const block = sectionMatch[1];

      const repoMatch = block.match(/[ \t]+repo\s*:\s*(.+)/);
      if (repoMatch) {
        repo = repoMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      const prMatch = block.match(/[ \t]+pr_number\s*:\s*(\d+)/);
      if (prMatch) {
        prNumber = parseInt(prMatch[1], 10);
      }
    }
  }

  if (!repo) return null;
  if (!isValidRepo(repo)) return null;

  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) return null;

  return { repo, token, ...(prNumber !== undefined ? { prNumber } : {}) };
}

function isValidRepo(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

// --- GitHub REST API client ---

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

async function githubRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// --- Issue management ---

/**
 * Create a GitHub issue for a sprint task.
 * Returns the issue number on success, null on failure.
 */
export async function createIssueForTask(
  task: TaskInfo,
  config: GitHubConfig
): Promise<number | null> {
  try {
    const result = await githubRequest("POST", `/repos/${config.repo}/issues`, config.token, {
      title: `[Sprint] ${task.subject}`,
      body: task.description
        ? `${task.description}\n\n---\n_Auto-created by TeamClaude for task #${task.id}_`
        : `_Auto-created by TeamClaude for task #${task.id}_`,
      labels: ["teamclaude", "sprint"],
    });

    if (!result.ok) {
      console.error(`[github] Failed to create issue for task #${task.id}: HTTP ${result.status}`);
      return null;
    }

    const issue = result.data as { number: number };
    console.log(`[github] Created issue #${issue.number} for task #${task.id}: ${task.subject}`);
    return issue.number;
  } catch (err: any) {
    console.error(`[github] Error creating issue for task #${task.id}:`, err.message);
    return null;
  }
}

/**
 * Create GitHub issues for all sprint tasks (fire-and-forget).
 * Skips tasks that already have issues (idempotent by subject match is not done here —
 * callers are responsible for calling this only once per sprint start).
 */
export async function createIssuesForSprint(
  tasks: TaskInfo[],
  config: GitHubConfig
): Promise<void> {
  const visible = tasks.filter((t) => t.status !== "deleted");
  for (const task of visible) {
    await createIssueForTask(task, config);
  }
}

// --- PR comments ---

/**
 * Post a comment on a GitHub pull request.
 * Returns the comment ID on success, null on failure.
 */
export async function commentOnPR(
  prNumber: number,
  body: string,
  config: GitHubConfig
): Promise<number | null> {
  try {
    const result = await githubRequest(
      "POST",
      `/repos/${config.repo}/issues/${prNumber}/comments`,
      config.token,
      { body }
    );

    if (!result.ok) {
      console.error(`[github] Failed to comment on PR #${prNumber}: HTTP ${result.status}`);
      return null;
    }

    const comment = result.data as { id: number };
    console.log(`[github] Posted comment on PR #${prNumber}`);
    return comment.id;
  } catch (err: any) {
    console.error(`[github] Error commenting on PR #${prNumber}:`, err.message);
    return null;
  }
}

/**
 * Post the sprint retrospective as a PR comment.
 */
export async function postRetroToPR(
  retroMarkdown: string,
  config: GitHubConfig
): Promise<void> {
  if (!config.prNumber) return;
  await commentOnPR(config.prNumber, retroMarkdown, config);
}

/**
 * Post a sprint status update comment on a PR.
 */
export async function postSprintStatusToPR(
  state: SprintState,
  config: GitHubConfig
): Promise<void> {
  if (!config.prNumber) return;

  const completed = state.tasks.filter((t) => t.status === "completed").length;
  const total = state.tasks.filter((t) => t.status !== "deleted").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const body = [
    `## Sprint Status Update — ${state.teamName ?? "Sprint"}`,
    "",
    `- **Phase:** ${state.phase}`,
    `- **Cycle:** ${state.cycle}`,
    `- **Progress:** ${completed}/${total} tasks completed (${pct}%)`,
    "",
    "_Posted automatically by TeamClaude_",
  ].join("\n");

  await commentOnPR(config.prNumber, body, config);
}
