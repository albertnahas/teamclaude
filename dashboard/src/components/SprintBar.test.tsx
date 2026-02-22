// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SprintBar } from "./SprintBar";
import type { SprintState } from "../types";

afterEach(cleanup);

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    teamName: null,
    projectName: null,
    agents: [],
    tasks: [],
    messages: [],
    paused: false,
    escalation: null,
    mergeConflict: null,
    mode: "manual",
    cycle: 0,
    phase: "idle",
    reviewTaskIds: [],
    validatingTaskIds: [],
    tokenUsage: { total: 0, byAgent: {}, estimatedCostUsd: 0 },
    checkpoints: [],
    pendingCheckpoint: null,
    tmuxAvailable: false,
    tmuxSessionName: null,
    ...overrides,
  };
}

const defaultProps = {
  theme: "dark" as const,
  onPause: vi.fn(),
  onStop: vi.fn(),
  onToggleTheme: vi.fn(),
};

// --- Basic SprintBar rendering ---

describe("SprintBar basic rendering", () => {
  it("renders project name when provided", () => {
    render(<SprintBar state={makeState({ projectName: "my-project" })} {...defaultProps} />);
    expect(screen.getByText("my-project")).toBeDefined();
  });

  it("renders team name when provided", () => {
    render(<SprintBar state={makeState({ teamName: "alpha-team" })} {...defaultProps} />);
    expect(screen.getByText("alpha-team")).toBeDefined();
  });

  it("renders mode", () => {
    render(<SprintBar state={makeState({ mode: "autonomous" })} {...defaultProps} />);
    expect(screen.getByText("autonomous")).toBeDefined();
  });

  it("renders Pause button", () => {
    render(<SprintBar state={makeState()} {...defaultProps} />);
    expect(screen.getByText("Pause")).toBeDefined();
  });

  it("renders Resume when paused", () => {
    render(<SprintBar state={makeState({ paused: true })} {...defaultProps} />);
    expect(screen.getByText("Resume")).toBeDefined();
  });

  it("renders Stop button", () => {
    render(<SprintBar state={makeState()} {...defaultProps} />);
    expect(screen.getByText("Stop")).toBeDefined();
  });
});

// --- BudgetBar visibility ---

describe("BudgetBar visibility", () => {
  it("is NOT rendered when no budget flags and tokenUsage.total is 0", () => {
    render(<SprintBar state={makeState()} {...defaultProps} />);
    expect(document.querySelector(".budget-bar-wrap")).toBeNull();
  });

  it("is NOT rendered when tokenUsage.total > 0 but no budget config or flags", () => {
    render(
      <SprintBar
        state={makeState({ tokenUsage: { total: 1000, byAgent: {}, estimatedCostUsd: 0.01 } })}
        {...defaultProps}
      />
    );
    expect(document.querySelector(".budget-bar-wrap")).toBeNull();
  });

  it("renders when tokenBudgetApproaching is true", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 8000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    expect(document.querySelector(".budget-bar-wrap")).not.toBeNull();
  });

  it("renders when tokenBudgetExceeded is true", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetExceeded: true,
          tokenUsage: { total: 10000, byAgent: {}, estimatedCostUsd: 0.10 },
        })}
        {...defaultProps}
      />
    );
    expect(document.querySelector(".budget-bar-wrap")).not.toBeNull();
  });

  it("renders when tokenBudgetConfig is set", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { tokens: 50000 },
          tokenUsage: { total: 1000, byAgent: {}, estimatedCostUsd: 0.01 },
        })}
        {...defaultProps}
      />
    );
    expect(document.querySelector(".budget-bar-wrap")).not.toBeNull();
  });
});

// --- BudgetBar color states ---

describe("BudgetBar color classes", () => {
  it("uses green fill class when budget is configured but not approaching or exceeded", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { tokens: 50000 },
          tokenUsage: { total: 1000, byAgent: {}, estimatedCostUsd: 0.01 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector(".budget-bar-fill");
    expect(fill?.className).toContain("budget-bar-fill--ok");
  });

  it("uses yellow/amber fill class when tokenBudgetApproaching is true", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 8000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector(".budget-bar-fill");
    expect(fill?.className).toContain("budget-bar-fill--approaching");
  });

  it("uses red fill class when tokenBudgetExceeded is true", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetExceeded: true,
          tokenUsage: { total: 10000, byAgent: {}, estimatedCostUsd: 0.10 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector(".budget-bar-fill");
    expect(fill?.className).toContain("budget-bar-fill--exceeded");
  });

  it("uses exceeded class (not approaching) when both flags are true", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenBudgetExceeded: true,
          tokenUsage: { total: 10000, byAgent: {}, estimatedCostUsd: 0.10 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector(".budget-bar-fill");
    expect(fill?.className).toContain("budget-bar-fill--exceeded");
    expect(fill?.className).not.toContain("budget-bar-fill--approaching");
  });
});

// --- BudgetBar fill percentage ---

describe("BudgetBar fill percentage", () => {
  it("sets fill width to 100% when tokenBudgetExceeded and no config", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetExceeded: true,
          tokenUsage: { total: 10000, byAgent: {}, estimatedCostUsd: 0.10 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector<HTMLElement>(".budget-bar-fill");
    expect(fill?.style.width).toBe("100%");
  });

  it("sets fill width to 85% when only tokenBudgetApproaching with no config", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 8000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector<HTMLElement>(".budget-bar-fill");
    expect(fill?.style.width).toBe("85%");
  });

  it("computes fill from token budget config", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { tokens: 10000 },
          tokenUsage: { total: 5000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector<HTMLElement>(".budget-bar-fill");
    expect(fill?.style.width).toBe("50%");
  });

  it("caps fill at 100% when usage exceeds config tokens", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { tokens: 1000 },
          tokenBudgetExceeded: true,
          tokenUsage: { total: 5000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    const fill = document.querySelector<HTMLElement>(".budget-bar-fill");
    expect(fill?.style.width).toBe("100%");
  });
});

// --- BudgetBar text display ---

describe("BudgetBar text display", () => {
  it("displays estimated cost formatted as $X.XX", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 8000, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/\$0\.05/)).toBeDefined();
  });

  it("displays token count as raw number for small values", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 500, byAgent: {}, estimatedCostUsd: 0.01 },
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/500/)).toBeDefined();
  });

  it("displays token count with k suffix for thousands", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetApproaching: true,
          tokenUsage: { total: 12450, byAgent: {}, estimatedCostUsd: 0.05 },
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/12k/)).toBeDefined();
  });

  it("displays max token budget when tokenBudgetConfig.tokens is set", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { tokens: 50000 },
          tokenUsage: { total: 1000, byAgent: {}, estimatedCostUsd: 0.01 },
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/50k/)).toBeDefined();
  });

  it("displays max USD budget when tokenBudgetConfig.usd is set", () => {
    render(
      <SprintBar
        state={makeState({
          tokenBudgetConfig: { usd: 5.00 },
          tokenUsage: { total: 1000, byAgent: {}, estimatedCostUsd: 0.01 },
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/\$5\.00/)).toBeDefined();
  });
});
