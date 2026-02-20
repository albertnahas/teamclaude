import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SprintState } from "./state.js";

const execFileAsync = promisify(execFile);

async function git(
  args: string[],
  cwd: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export async function createSprintBranch(
  teamName: string,
  cycle: number,
  cwd: string
): Promise<string | null> {
  const branch = `sprint/${teamName}-cycle${cycle}`;
  try {
    // git checkout -b writes to stderr; exit code 0 means success regardless of stdout
    await execFileAsync("git", ["checkout", "-b", branch], { cwd });
    return branch;
  } catch {
    // Branch may already exist — verify we're on it
    const current = await getCurrentBranch(cwd);
    return current === branch ? branch : null;
  }
}

export async function generatePRSummary(
  state: SprintState,
  cwd: string
): Promise<string> {
  const { teamName, cycle, tasks } = state;
  const sprintBranch = `sprint/${teamName}-cycle${cycle}`;
  const baseBranch = await git(
    ["rev-parse", "--abbrev-ref", "HEAD@{upstream}"],
    cwd
  ) ?? "main";

  const log = await git(
    ["log", "--oneline", `${baseBranch}..${sprintBranch}`],
    cwd
  );

  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;

  const commitLines =
    log
      ?.split("\n")
      .filter(Boolean)
      .map((l) => `- ${l}`)
      .join("\n") ?? "";

  return [
    `## Sprint: ${teamName ?? "unnamed"} — Cycle ${cycle}`,
    "",
    `**Tasks:** ${completed}/${total} completed`,
    "",
    "### Commits",
    commitLines || "_No commits on sprint branch_",
  ].join("\n");
}
