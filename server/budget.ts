import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// --- Types ---

export interface BudgetConfig {
  tokens?: number;
  usd?: number;
}

// --- Config loading ---

/**
 * Parse token budget config from .sprint.yml.
 * Returns null if not configured or if neither limit is set.
 */
export function loadBudgetConfig(cwd: string): BudgetConfig | null {
  const sprintYml = join(cwd, ".sprint.yml");
  if (!existsSync(sprintYml)) return null;

  let raw: string;
  try {
    raw = readFileSync(sprintYml, "utf-8");
  } catch {
    return null;
  }

  const sprintSectionMatch = raw.match(/^sprint\s*:\s*\n((?:[ \t]+\S[^\n]*\n?)*)/m);
  if (!sprintSectionMatch) return null;

  const block = sprintSectionMatch[1];

  const tokensMatch = block.match(/[ \t]+token_budget\s*:\s*(\d+)/);
  const usdMatch = block.match(/[ \t]+token_budget_usd\s*:\s*([\d.]+)/);

  if (!tokensMatch && !usdMatch) return null;

  const config: BudgetConfig = {};
  if (tokensMatch) config.tokens = parseInt(tokensMatch[1], 10);
  if (usdMatch) config.usd = parseFloat(usdMatch[1]);
  return config;
}

// --- Budget check ---

export type BudgetResult = "ok" | "approaching" | "exceeded";

/** Threshold at which the "approaching" warning fires (80% of limit). */
export const BUDGET_WARN_THRESHOLD = 0.8;

export function checkBudget(
  usage: { total: number; estimatedCostUsd: number },
  config: BudgetConfig
): BudgetResult {
  if (config.tokens !== undefined && usage.total >= config.tokens) return "exceeded";
  if (config.usd !== undefined && usage.estimatedCostUsd >= config.usd) return "exceeded";
  if (config.tokens !== undefined && usage.total >= config.tokens * BUDGET_WARN_THRESHOLD) return "approaching";
  if (config.usd !== undefined && usage.estimatedCostUsd >= config.usd * BUDGET_WARN_THRESHOLD) return "approaching";
  return "ok";
}
