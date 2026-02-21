import { readFileSync, existsSync } from "node:fs";
import { scoreTaskComplexity } from "./complexity.js";
import type { TaskInfo } from "./state.js";

export interface ModelRoutingDecision {
  model: string;
  tier: "simple" | "medium" | "complex";
  score: number;
  reason: string;
}

export const MODEL_FOR_TIER: Record<"simple" | "medium" | "complex", string> = {
  simple: "claude-haiku-4-5-20251001",
  medium: "claude-sonnet-4-6",
  complex: "claude-opus-4-6",
};

export function loadModelOverrides(sprintYmlPath: string): Record<string, string> {
  if (!existsSync(sprintYmlPath)) return {};
  try {
    const content = readFileSync(sprintYmlPath, "utf-8");
    // Find the `models:` section, then `overrides:` beneath it
    const modelsMatch = content.match(/^models\s*:\s*\n((?:[ \t]+.+\n?)*)/m);
    if (!modelsMatch) return {};

    const modelsBlock = modelsMatch[1];
    const overridesMatch = modelsBlock.match(/[ \t]+overrides\s*:\s*\n((?:[ \t]+.+\n?)*)/m);
    if (!overridesMatch) return {};

    const overridesBlock = overridesMatch[1];
    const result: Record<string, string> = {};

    for (const line of overridesBlock.split("\n")) {
      // Match lines like:   "1": claude-opus-4-6  or  1: claude-opus-4-6
      const m = line.match(/^\s+"?(\w+)"?\s*:\s*(\S+)/);
      if (m) result[m[1]] = m[2];
    }

    return result;
  } catch {
    return {};
  }
}

export function routeTaskToModel(
  task: TaskInfo,
  overrides?: Record<string, string>
): ModelRoutingDecision {
  const { tier, score, reason } = scoreTaskComplexity(task);

  if (overrides?.[task.id]) {
    return {
      model: overrides[task.id],
      tier,
      score,
      reason: `manual override (complexity: ${reason})`,
    };
  }

  return {
    model: MODEL_FOR_TIER[tier],
    tier,
    score,
    reason,
  };
}
