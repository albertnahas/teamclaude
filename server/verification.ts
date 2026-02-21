import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export interface VerificationCommands {
  typeCheck?: string;
  test?: string;
  lint?: string;
}

export interface VerificationResult {
  passed: boolean;
  results: { name: string; command: string; passed: boolean; output: string }[];
}

// --- Config loading ---

/**
 * Load verification commands from .sprint.yml.
 * Falls back to auto-detection from project config files.
 */
export function loadVerificationCommands(cwd: string): VerificationCommands {
  const commands: VerificationCommands = {};

  // 1. Try .sprint.yml
  const sprintYml = join(cwd, ".sprint.yml");
  if (existsSync(sprintYml)) {
    try {
      const raw = readFileSync(sprintYml, "utf-8");
      const section = raw.match(/^verification\s*:\s*\n((?:[ \t]+.+\n?)*)/m);
      if (section) {
        const block = section[1];
        const typeCheck = block.match(/[ \t]+type_check\s*:\s*"?([^"\n]+)"?/);
        const test = block.match(/[ \t]+test\s*:\s*"?([^"\n]+)"?/);
        const lint = block.match(/[ \t]+lint\s*:\s*"?([^"\n]+)"?/);
        if (typeCheck) commands.typeCheck = typeCheck[1].trim();
        if (test) commands.test = test[1].trim();
        if (lint) commands.lint = lint[1].trim();
        // If any command was explicitly set, return (even partial config is intentional)
        if (commands.typeCheck || commands.test || commands.lint) return commands;
      }
    } catch {}
  }

  // 2. Auto-detect from project
  return autoDetectCommands(cwd);
}

function autoDetectCommands(cwd: string): VerificationCommands {
  const commands: VerificationCommands = {};
  const runner = detectPackageRunner(cwd);

  // Node.js projects
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts ?? {};

      if (scripts["type-check"]) commands.typeCheck = `${runner} run type-check`;
      else if (scripts["typecheck"]) commands.typeCheck = `${runner} run typecheck`;

      if (scripts["test:run"]) commands.test = `${runner} run test:run`;
      else if (scripts["test"]) commands.test = `${runner} test`;

      if (scripts["lint"]) commands.lint = `${runner} run lint`;
    } catch {}
    return commands;
  }

  // Python projects
  const pyproject = join(cwd, "pyproject.toml");
  if (existsSync(pyproject)) {
    try {
      const raw = readFileSync(pyproject, "utf-8");
      if (raw.includes("pytest")) commands.test = "python -m pytest";
      if (raw.includes("mypy")) commands.typeCheck = "python -m mypy .";
      if (raw.includes("ruff")) commands.lint = "python -m ruff check .";
    } catch {}
    return commands;
  }

  // Rust projects
  if (existsSync(join(cwd, "Cargo.toml"))) {
    commands.typeCheck = "cargo check";
    commands.test = "cargo test";
    commands.lint = "cargo clippy -- -D warnings";
    return commands;
  }

  // Go projects
  if (existsSync(join(cwd, "go.mod"))) {
    commands.test = "go test ./...";
    commands.typeCheck = "go vet ./...";
    return commands;
  }

  return commands;
}

function detectPackageRunner(cwd: string): string {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

// --- Execution ---

/**
 * Run all configured verification commands sequentially.
 * Returns overall pass/fail and per-command results.
 */
export async function runVerification(cwd: string): Promise<VerificationResult> {
  const commands = loadVerificationCommands(cwd);
  const entries: [string, string][] = [];

  if (commands.typeCheck) entries.push(["type-check", commands.typeCheck]);
  if (commands.lint) entries.push(["lint", commands.lint]);
  if (commands.test) entries.push(["test", commands.test]);

  if (entries.length === 0) {
    return { passed: true, results: [] };
  }

  const results: VerificationResult["results"] = [];

  for (const [name, command] of entries) {
    const [cmd, ...args] = command.split(/\s+/);
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        timeout: 120_000,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      });
      results.push({ name, command, passed: true, output: (stdout + stderr).slice(-2000) });
    } catch (err: any) {
      const output = ((err.stdout ?? "") + (err.stderr ?? "")).slice(-2000) || err.message;
      results.push({ name, command, passed: false, output });
    }
  }

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}
