import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBudgetConfig, checkBudget, BUDGET_WARN_THRESHOLD } from "./budget.js";

// --- loadBudgetConfig ---

describe("loadBudgetConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tc-budget-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when .sprint.yml does not exist", () => {
    expect(loadBudgetConfig(tmpDir)).toBeNull();
  });

  it("returns null when sprint section is absent", () => {
    writeFileSync(join(tmpDir, ".sprint.yml"), "agents:\n  model: sonnet\n", "utf-8");
    expect(loadBudgetConfig(tmpDir)).toBeNull();
  });

  it("returns null when sprint section has no budget keys", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "sprint:\n  max_review_rounds: 3\n",
      "utf-8"
    );
    expect(loadBudgetConfig(tmpDir)).toBeNull();
  });

  it("parses token_budget", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "sprint:\n  token_budget: 100000\n",
      "utf-8"
    );
    const config = loadBudgetConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.tokens).toBe(100000);
    expect(config!.usd).toBeUndefined();
  });

  it("parses token_budget_usd", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "sprint:\n  token_budget_usd: 5.00\n",
      "utf-8"
    );
    const config = loadBudgetConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.usd).toBe(5.0);
    expect(config!.tokens).toBeUndefined();
  });

  it("parses both token_budget and token_budget_usd", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "sprint:\n  token_budget: 50000\n  token_budget_usd: 2.50\n",
      "utf-8"
    );
    const config = loadBudgetConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.tokens).toBe(50000);
    expect(config!.usd).toBe(2.5);
  });

  it("parses budget alongside other sprint settings", () => {
    writeFileSync(
      join(tmpDir, ".sprint.yml"),
      "sprint:\n  max_review_rounds: 3\n  token_budget: 75000\n",
      "utf-8"
    );
    const config = loadBudgetConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.tokens).toBe(75000);
  });
});

// --- checkBudget ---

describe("checkBudget", () => {
  const usage = { total: 1000, estimatedCostUsd: 0.05 };

  it("BUDGET_WARN_THRESHOLD is 0.8", () => {
    expect(BUDGET_WARN_THRESHOLD).toBe(0.8);
  });

  it("returns ok when well under both limits", () => {
    expect(checkBudget(usage, { tokens: 2000, usd: 1.00 })).toBe("ok");
  });

  it("returns approaching when tokens reach 80% of limit", () => {
    // usage.total = 1000; 80% of 1250 = 1000
    expect(checkBudget(usage, { tokens: 1250 })).toBe("approaching");
  });

  it("returns approaching when tokens exceed 80% but are under 100%", () => {
    // usage.total = 1000; 80% of 1100 = 880 < 1000 < 1100
    expect(checkBudget(usage, { tokens: 1100 })).toBe("approaching");
  });

  it("returns approaching when cost reaches 80% of usd limit", () => {
    // usage.estimatedCostUsd = 0.05; 80% of 0.0625 = 0.05
    expect(checkBudget(usage, { usd: 0.0625 })).toBe("approaching");
  });

  it("returns exceeded when total tokens meet the token limit", () => {
    expect(checkBudget(usage, { tokens: 1000 })).toBe("exceeded");
  });

  it("returns exceeded when total tokens exceed the token limit", () => {
    expect(checkBudget(usage, { tokens: 999 })).toBe("exceeded");
  });

  it("returns exceeded when cost meets the usd limit", () => {
    expect(checkBudget(usage, { usd: 0.05 })).toBe("exceeded");
  });

  it("returns exceeded when cost exceeds the usd limit", () => {
    expect(checkBudget(usage, { usd: 0.04 })).toBe("exceeded");
  });

  it("exceeded takes priority over approaching — token limit", () => {
    expect(checkBudget(usage, { tokens: 500, usd: 1.00 })).toBe("exceeded");
  });

  it("exceeded takes priority over approaching — usd limit", () => {
    expect(checkBudget(usage, { tokens: 5000, usd: 0.04 })).toBe("exceeded");
  });

  it("returns ok with empty config (no limits set)", () => {
    expect(checkBudget(usage, {})).toBe("ok");
  });

  it("returns ok for zero usage with non-zero limits", () => {
    const zero = { total: 0, estimatedCostUsd: 0 };
    expect(checkBudget(zero, { tokens: 1, usd: 0.01 })).toBe("ok");
  });
});
