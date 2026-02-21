import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { state, broadcast, type MergeConflict } from "./state.js";

const execFileAsync = promisify(execFile);

const WORKTREES_BASE = join(homedir(), ".claude", "worktrees");

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function createEngineerWorktree(
  teamName: string,
  engineerName: string,
  cwd: string
): Promise<{ path: string; branch: string } | null> {
  const worktreePath = join(WORKTREES_BASE, "sprint", teamName, engineerName);
  const branch = getWorktreeBranch(teamName, engineerName);

  try {
    await mkdir(join(WORKTREES_BASE, "sprint", teamName), { recursive: true });
    await execFileAsync("git", ["worktree", "add", worktreePath, "-b", branch], { cwd });
    return { path: worktreePath, branch };
  } catch {
    // Worktree or branch may already exist — verify it's listed
    const existing = await listWorktrees(cwd);
    const found = existing.find((w) => w.path === worktreePath);
    return found ?? null;
  }
}

export function getWorktreeBranch(teamName: string, engineerName: string): string {
  return `sprint/${teamName}/${engineerName}`;
}

export async function getWorktreeDiff(
  teamName: string,
  engineerName: string,
  baseBranch: string,
  cwd: string
): Promise<string | null> {
  const worktreeBranch = getWorktreeBranch(teamName, engineerName);
  return git(["diff", `${baseBranch}...${worktreeBranch}`], cwd);
}

export async function mergeWorktreeBranch(
  teamName: string,
  engineerName: string,
  baseBranch: string,
  cwd: string
): Promise<{ success: boolean; conflict: boolean; conflictingFiles: string[] }> {
  const worktreeBranch = getWorktreeBranch(teamName, engineerName);

  const checkout = await git(["checkout", baseBranch], cwd);
  if (checkout === null) {
    return { success: false, conflict: false, conflictingFiles: [] };
  }

  try {
    await execFileAsync("git", ["merge", "--no-ff", worktreeBranch], { cwd });
    return { success: true, conflict: false, conflictingFiles: [] };
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const isConflict = stderr.includes("CONFLICT") || stderr.includes("Automatic merge failed");
    if (isConflict) {
      // Collect conflicting files before aborting
      const conflictingFiles = await getConflictingFiles(cwd);
      await git(["merge", "--abort"], cwd);
      return { success: false, conflict: true, conflictingFiles };
    }
    return { success: false, conflict: false, conflictingFiles: [] };
  }
}

export async function getConflictingFiles(cwd: string): Promise<string[]> {
  const output = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

export async function mergeWithConflictEscalation(
  teamName: string,
  engineerName: string,
  baseBranch: string,
  cwd: string
): Promise<{ success: boolean; conflict: boolean }> {
  const result = await mergeWorktreeBranch(teamName, engineerName, baseBranch, cwd);

  if (result.conflict) {
    const mergeConflict: MergeConflict = {
      engineerName,
      baseBranch,
      worktreeBranch: getWorktreeBranch(teamName, engineerName),
      conflictingFiles: result.conflictingFiles,
      timestamp: Date.now(),
    };
    state.mergeConflict = mergeConflict;
    broadcast({ type: "merge_conflict", mergeConflict });
  }

  return { success: result.success, conflict: result.conflict };
}

export async function listWorktrees(
  cwd: string
): Promise<{ path: string; branch: string }[]> {
  const output = await git(["worktree", "list", "--porcelain"], cwd);
  if (!output) return [];

  const worktrees: { path: string; branch: string }[] = [];
  let currentPath = "";
  let currentBranch = "";

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      currentBranch = "";
    } else if (line.startsWith("branch ")) {
      // branch refs/heads/sprint/team/engineer-1 -> sprint/team/engineer-1
      currentBranch = line.slice("branch refs/heads/".length);
    } else if (line === "" && currentPath && currentBranch) {
      worktrees.push({ path: currentPath, branch: currentBranch });
      currentPath = "";
      currentBranch = "";
    }
  }

  // Handle last entry with no trailing blank line
  if (currentPath && currentBranch) {
    worktrees.push({ path: currentPath, branch: currentBranch });
  }

  return worktrees;
}

export async function removeEngineerWorktree(
  teamName: string,
  engineerName: string,
  cwd: string
): Promise<boolean> {
  const worktreePath = join(WORKTREES_BASE, "sprint", teamName, engineerName);
  const branch = getWorktreeBranch(teamName, engineerName);

  const existing = await listWorktrees(cwd);
  if (!existing.some((w) => w.path === worktreePath)) return false;

  const removed = await git(["worktree", "remove", worktreePath, "--force"], cwd);
  const deleted = await git(["branch", "-D", branch], cwd);
  return removed !== null || deleted !== null;
}

export async function cleanupAllWorktrees(
  teamName: string,
  cwd: string
): Promise<void> {
  const all = await listWorktrees(cwd);
  const prefix = `sprint/${teamName}/`;
  const ours = all.filter((w) => w.path.includes(prefix));
  await Promise.allSettled(
    ours.map((w) => {
      const engineerName = w.path.split(prefix)[1];
      return removeEngineerWorktree(teamName, engineerName, cwd);
    })
  );
}
