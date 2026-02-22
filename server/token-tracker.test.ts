import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock modules before importing token-tracker
vi.mock("./state.js", () => {
  const state = {
    tokenUsage: { total: 0, byAgent: {} as Record<string, number>, estimatedCostUsd: 0 },
    tokenBudgetApproaching: false as boolean | undefined,
    tokenBudgetExceeded: false as boolean | undefined,
    tokenBudgetConfig: undefined as { tokens?: number; usd?: number } | undefined,
    paused: false,
  };
  return {
    state,
    broadcast: vi.fn(),
  };
});

vi.mock("./notifications.js", () => ({ notifyWebhook: vi.fn() }));

vi.mock("./budget.js", () => ({
  loadBudgetConfig: vi.fn(() => null),
  checkBudget: vi.fn(() => "ok"),
}));

import { accumulateTokenUsage, resolveModelPricing, PRICING_TABLE } from "./token-tracker.js";
import { state, broadcast } from "./state.js";
import { notifyWebhook } from "./notifications.js";
import { loadBudgetConfig, checkBudget } from "./budget.js";

function resetState() {
  state.tokenUsage = { total: 0, byAgent: {}, estimatedCostUsd: 0 };
  state.tokenBudgetApproaching = false;
  state.tokenBudgetExceeded = false;
  state.tokenBudgetConfig = undefined;
  state.paused = false;
}

describe("accumulateTokenUsage", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    vi.mocked(loadBudgetConfig).mockReturnValue(null);
    vi.mocked(checkBudget).mockReturnValue("ok");
  });

  it("accumulates tokens to state.tokenUsage.total", () => {
    accumulateTokenUsage("agent-1", 100, 50);
    expect(state.tokenUsage.total).toBe(150);

    accumulateTokenUsage("agent-1", 200, 100);
    expect(state.tokenUsage.total).toBe(450);
  });

  it("accumulates per-agent in state.tokenUsage.byAgent", () => {
    accumulateTokenUsage("agent-1", 100, 50);
    accumulateTokenUsage("agent-2", 200, 100);
    accumulateTokenUsage("agent-1", 50, 25);

    expect(state.tokenUsage.byAgent["agent-1"]).toBe(225); // 150 + 75
    expect(state.tokenUsage.byAgent["agent-2"]).toBe(300);
  });

  it("calculates estimatedCostUsd using model pricing (input + output)", () => {
    // sonnet pricing: input $3/MTok, output $15/MTok
    // 1000 input + 500 output with sonnet = (1000*3 + 500*15) / 1_000_000 = 0.0105
    // But resolveModelPricing reads actual .sprint.yml, so test the accumulated value
    // by checking it is non-zero and consistent with the formula
    accumulateTokenUsage("agent-1", 1000, 500);
    const pricing = resolveModelPricing();
    const expected = (1000 * pricing.input + 500 * pricing.output) / 1_000_000;
    expect(state.tokenUsage.estimatedCostUsd).toBeCloseTo(expected);
  });

  it("broadcasts token_usage event after accumulation", () => {
    accumulateTokenUsage("agent-1", 100, 50);
    expect(broadcast).toHaveBeenCalledWith({
      type: "token_usage",
      usage: state.tokenUsage,
    });
  });

  it("does not fire budget events when loadBudgetConfig returns null", () => {
    vi.mocked(loadBudgetConfig).mockReturnValue(null);
    accumulateTokenUsage("agent-1", 100, 50);

    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "token_budget_approaching" })
    );
    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "token_budget_exceeded" })
    );
    expect(notifyWebhook).not.toHaveBeenCalled();
  });

  it("sets tokenBudgetApproaching and broadcasts token_budget_approaching when checkBudget returns approaching", () => {
    vi.mocked(loadBudgetConfig).mockReturnValue({ tokens: 1000 });
    vi.mocked(checkBudget).mockReturnValue("approaching");

    accumulateTokenUsage("agent-1", 100, 50);

    expect(state.tokenBudgetApproaching).toBe(true);
    expect(broadcast).toHaveBeenCalledWith({
      type: "token_budget_approaching",
      usage: state.tokenUsage,
    });
    expect(notifyWebhook).not.toHaveBeenCalled();
  });

  it("does not re-fire token_budget_approaching after already set (single-fire guard)", () => {
    vi.mocked(loadBudgetConfig).mockReturnValue({ tokens: 1000 });
    vi.mocked(checkBudget).mockReturnValue("approaching");

    accumulateTokenUsage("agent-1", 100, 50);
    vi.clearAllMocks();

    accumulateTokenUsage("agent-1", 100, 50);

    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "token_budget_approaching" })
    );
  });

  it("sets paused, tokenBudgetExceeded, broadcasts paused + token_budget_exceeded, calls notifyWebhook when exceeded", () => {
    vi.mocked(loadBudgetConfig).mockReturnValue({ tokens: 100 });
    vi.mocked(checkBudget).mockReturnValue("exceeded");

    accumulateTokenUsage("agent-1", 100, 50);

    expect(state.paused).toBe(true);
    expect(state.tokenBudgetExceeded).toBe(true);
    expect(state.tokenBudgetApproaching).toBe(true);
    expect(broadcast).toHaveBeenCalledWith({ type: "paused", paused: true });
    expect(broadcast).toHaveBeenCalledWith({
      type: "token_budget_exceeded",
      usage: state.tokenUsage,
    });
    expect(notifyWebhook).toHaveBeenCalledWith("token_budget_exceeded", {
      total: state.tokenUsage.total,
      estimatedCostUsd: state.tokenUsage.estimatedCostUsd,
    });
  });

  it("does not re-fire budget events after tokenBudgetExceeded is set (single-fire guard)", () => {
    vi.mocked(loadBudgetConfig).mockReturnValue({ tokens: 100 });
    vi.mocked(checkBudget).mockReturnValue("exceeded");

    accumulateTokenUsage("agent-1", 100, 50);
    vi.clearAllMocks();

    accumulateTokenUsage("agent-1", 100, 50);

    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "token_budget_exceeded" })
    );
    expect(notifyWebhook).not.toHaveBeenCalled();
    // loadBudgetConfig should not even be called once tokenBudgetExceeded is set
    expect(loadBudgetConfig).not.toHaveBeenCalled();
  });

  it("caches tokenBudgetConfig into state on first budget detection", () => {
    const config = { tokens: 50000 };
    vi.mocked(loadBudgetConfig).mockReturnValue(config);
    vi.mocked(checkBudget).mockReturnValue("ok");

    expect(state.tokenBudgetConfig).toBeUndefined();
    accumulateTokenUsage("agent-1", 100, 50);
    expect(state.tokenBudgetConfig).toEqual(config);
  });

  it("does not overwrite tokenBudgetConfig once set", () => {
    const config1 = { tokens: 50000 };
    const config2 = { tokens: 99999 };
    vi.mocked(loadBudgetConfig).mockReturnValue(config1);
    vi.mocked(checkBudget).mockReturnValue("ok");

    accumulateTokenUsage("agent-1", 100, 50);
    expect(state.tokenBudgetConfig).toEqual(config1);

    vi.mocked(loadBudgetConfig).mockReturnValue(config2);
    accumulateTokenUsage("agent-1", 100, 50);
    expect(state.tokenBudgetConfig).toEqual(config1); // unchanged
  });
});

// --- resolveModelPricing ---

describe("resolveModelPricing", () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tc-token-tracker-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to sonnet pricing when no .sprint.yml present", () => {
    const pricing = resolveModelPricing();
    expect(pricing).toEqual(PRICING_TABLE.sonnet);
  });

  it("defaults to sonnet when .sprint.yml has no agents.model", () => {
    writeFileSync(join(tmpDir, ".sprint.yml"), "sprint:\n  max_review_rounds: 3\n", "utf-8");
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.sonnet);
  });

  it("returns haiku pricing when model is haiku", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "agents:\n  model: haiku\n",
      "utf-8"
    );
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.haiku);
  });

  it("returns opus pricing when model is opus", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "agents:\n  model: opus\n",
      "utf-8"
    );
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.opus);
  });

  it("returns sonnet pricing when model is sonnet", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "agents:\n  model: sonnet\n",
      "utf-8"
    );
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.sonnet);
  });

  it("matches model name case-insensitively", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "agents:\n  model: claude-haiku-4-5-20251001\n",
      "utf-8"
    );
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.haiku);
  });

  it("defaults to sonnet for unknown model name", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "agents:\n  model: unknown-model-xyz\n",
      "utf-8"
    );
    expect(resolveModelPricing()).toEqual(PRICING_TABLE.sonnet);
  });
});
