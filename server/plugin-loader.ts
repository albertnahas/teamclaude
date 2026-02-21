import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import type { SprintState, TaskInfo } from "./state.js";

// --- Types ---

export interface TeamClaudePlugin {
  name: string;
  hooks?: {
    onSprintStart?: (state: SprintState) => void | Promise<void>;
    onTaskComplete?: (task: TaskInfo, state: SprintState) => void | Promise<void>;
    onEscalation?: (escalation: SprintState["escalation"], state: SprintState) => void | Promise<void>;
    onSprintStop?: (state: SprintState) => void | Promise<void>;
  };
}

// --- Config parsing ---

/**
 * Load plugin paths from .sprint.yml plugins section.
 * Supports both relative paths (./my-plugin.js) and npm package names.
 */
export function loadPluginPaths(cwd: string = process.cwd()): string[] {
  const sprintYml = join(cwd, ".sprint.yml");
  if (!existsSync(sprintYml)) return [];

  let raw: string;
  try {
    raw = readFileSync(sprintYml, "utf-8");
  } catch {
    return [];
  }

  // Match the plugins block (list of items under `plugins:`)
  const sectionMatch = raw.match(/^plugins\s*:\s*\n((?:[ \t]+-\s*.+\n?)*)/m);
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split("\n")
    .map((line) => line.replace(/^[ \t]+-\s*/, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * Resolve a plugin path to an absolute path or npm package name.
 * Relative paths (starting with ./ or ../) are resolved from cwd.
 */
function resolvePluginPath(pluginPath: string, cwd: string): string {
  if (pluginPath.startsWith("./") || pluginPath.startsWith("../") || isAbsolute(pluginPath)) {
    return resolve(cwd, pluginPath);
  }
  // npm package name — return as-is for dynamic import
  return pluginPath;
}

// --- Plugin registry ---

const _plugins: TeamClaudePlugin[] = [];

export function getPlugins(): ReadonlyArray<TeamClaudePlugin> {
  return _plugins;
}

/**
 * Load and register plugins from configured paths.
 * Also scans `.teamclaude/plugins/` for auto-discovered plugins.
 * Safe: errors are caught and logged; a broken plugin never crashes the server.
 */
export async function loadPlugins(cwd: string = process.cwd()): Promise<void> {
  _plugins.length = 0;

  const configuredPaths = loadPluginPaths(cwd);

  // Auto-discover plugins from .teamclaude/plugins/
  const pluginsDir = join(cwd, ".teamclaude", "plugins");
  const discoveredPaths: string[] = [];
  if (existsSync(pluginsDir)) {
    try {
      const entries = readdirSync(pluginsDir);
      for (const entry of entries) {
        if (entry.endsWith(".js") || entry.endsWith(".mjs") || entry.endsWith(".cjs")) {
          discoveredPaths.push(join(pluginsDir, entry));
        }
      }
    } catch (err: any) {
      console.error("[plugins] Failed to scan plugin directory:", err.message);
    }
  }

  const allPaths = [...new Set([...configuredPaths.map((p) => resolvePluginPath(p, cwd)), ...discoveredPaths])];

  for (const pluginPath of allPaths) {
    try {
      const mod = await import(pluginPath);
      const plugin: TeamClaudePlugin = mod.default ?? mod;

      if (!plugin || typeof plugin !== "object" || typeof plugin.name !== "string") {
        console.warn(`[plugins] Skipping invalid plugin at ${pluginPath} — must export { name, hooks? }`);
        continue;
      }

      _plugins.push(plugin);
      console.log(`[plugins] Loaded plugin: ${plugin.name}`);
    } catch (err: any) {
      console.error(`[plugins] Failed to load plugin at ${pluginPath}:`, err.message);
    }
  }
}

// --- Hook dispatchers ---

async function runHook<T extends keyof NonNullable<TeamClaudePlugin["hooks"]>>(
  hook: T,
  ...args: Parameters<NonNullable<NonNullable<TeamClaudePlugin["hooks"]>[T]>>
): Promise<void> {
  for (const plugin of _plugins) {
    const fn = plugin.hooks?.[hook] as ((...a: unknown[]) => void | Promise<void>) | undefined;
    if (!fn) continue;
    try {
      await fn(...args);
    } catch (err: any) {
      console.error(`[plugins] ${plugin.name} hook ${hook} threw:`, err.message);
    }
  }
}

export function fireOnSprintStart(state: SprintState): void {
  runHook("onSprintStart", state).catch(() => {});
}

export function fireOnTaskComplete(task: TaskInfo, state: SprintState): void {
  runHook("onTaskComplete", task, state).catch(() => {});
}

export function fireOnEscalation(escalation: SprintState["escalation"], state: SprintState): void {
  runHook("onEscalation", escalation, state).catch(() => {});
}

export function fireOnSprintStop(state: SprintState): void {
  runHook("onSprintStop", state).catch(() => {});
}
