import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let projectRoot: string | null = null;

export function setProjectRoot(cwd: string) {
  projectRoot = cwd;
}

export function getProjectRoot(): string {
  if (!projectRoot) throw new Error("projectRoot not set — call setProjectRoot() first");
  return projectRoot;
}

export function tcDir(): string {
  return join(getProjectRoot(), ".teamclaude");
}

export function statePath(): string {
  return join(tcDir(), "state.json");
}

export function analyticsPath(): string {
  return join(tcDir(), "analytics.json");
}

export function learningsPath(): string {
  return join(tcDir(), "learnings.md");
}

export function historyDir(): string {
  return join(tcDir(), "history");
}

export function sprintHistoryDir(id: string): string {
  return join(historyDir(), id);
}

let storageEnsured = false;

export function ensureStorageDir() {
  if (storageEnsured) return;
  const dir = tcDir();
  mkdirSync(dir, { recursive: true });
  const gitignorePath = join(dir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "state.json\nanalytics.json\n", "utf-8");
  }
  storageEnsured = true;
}

export function ensureSprintHistoryDir(id: string): string {
  const dir = sprintHistoryDir(id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function generateSprintId(): string {
  return `sprint-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "")}`;
}

/** Reset ensured flag — for testing only */
export function _resetEnsured() {
  storageEnsured = false;
}
