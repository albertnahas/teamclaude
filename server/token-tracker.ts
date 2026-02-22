import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, broadcast } from "./state.js";
import { notifyWebhook } from "./notifications.js";
import { loadBudgetConfig, checkBudget } from "./budget.js";

// --- Pricing table ---
// Prices in USD per million tokens (MTok).
// Source: https://www.anthropic.com/pricing (Feb 2025)

export const PRICING_TABLE: Record<string, { input: number; output: number }> = {
  haiku:  { input: 0.25, output: 1.25 },
  sonnet: { input: 3,    output: 15 },
  opus:   { input: 15,   output: 75 },
};

export function resolveModelPricing(): { input: number; output: number } {
  const sprintYml = join(process.cwd(), ".sprint.yml");
  if (existsSync(sprintYml)) {
    try {
      const raw = readFileSync(sprintYml, "utf-8");
      const m = raw.match(/^agents:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+model:\s*(\S+)/m);
      if (m) {
        const model = m[1].toLowerCase();
        for (const key of Object.keys(PRICING_TABLE)) {
          if (model.includes(key)) return PRICING_TABLE[key];
        }
      }
    } catch {}
  }
  return PRICING_TABLE.sonnet;
}

export function accumulateTokenUsage(
  agentName: string,
  inputTokens: number,
  outputTokens: number
): void {
  // Resolve pricing per-call so sprint.yml changes take effect without restart
  const { input: INPUT_COST_PER_MTOK, output: OUTPUT_COST_PER_MTOK } = resolveModelPricing();
  const tokens = inputTokens + outputTokens;
  state.tokenUsage.total += tokens;
  state.tokenUsage.byAgent[agentName] =
    (state.tokenUsage.byAgent[agentName] || 0) + tokens;
  state.tokenUsage.estimatedCostUsd +=
    (inputTokens * INPUT_COST_PER_MTOK + outputTokens * OUTPUT_COST_PER_MTOK) /
    1_000_000;
  broadcast({ type: "token_usage", usage: state.tokenUsage });

  // Check token budget — approaching (80%) and exceeded (100%) each fire once per sprint
  if (!state.tokenBudgetExceeded) {
    const budgetConfig = loadBudgetConfig(process.cwd());
    if (budgetConfig) {
      // Cache budget config in state so frontend can display it
      if (!state.tokenBudgetConfig) state.tokenBudgetConfig = budgetConfig;
      const result = checkBudget(state.tokenUsage, budgetConfig);
      if (result === "exceeded" && !state.paused) {
        state.paused = true;
        state.tokenBudgetExceeded = true;
        state.tokenBudgetApproaching = true;
        broadcast({ type: "paused", paused: true });
        broadcast({ type: "token_budget_exceeded", usage: state.tokenUsage });
        notifyWebhook("token_budget_exceeded", {
          total: state.tokenUsage.total,
          estimatedCostUsd: state.tokenUsage.estimatedCostUsd,
        });
        console.log("[budget] Token budget exceeded — sprint paused");
      } else if (result === "approaching" && !state.tokenBudgetApproaching) {
        state.tokenBudgetApproaching = true;
        broadcast({ type: "token_budget_approaching", usage: state.tokenUsage });
        console.log("[budget] Token budget approaching limit (>80%)");
      }
    }
  }
}
