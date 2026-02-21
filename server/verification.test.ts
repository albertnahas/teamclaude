import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadVerificationCommands, runVerification } from "./verification.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  return { execFile };
});

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: vi.fn((fn: any) => fn),
  };
});

beforeEach(() => {
  vi.mocked(existsSync).mockReset();
  vi.mocked(readFileSync).mockReset();
});

describe("loadVerificationCommands", () => {
  it("returns commands from .sprint.yml when present", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".sprint.yml")
    );
    vi.mocked(readFileSync).mockReturnValue(
      `verification:\n  type_check: "tsc --noEmit"\n  test: "vitest run"\n  lint: "eslint ."\n`
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds).toEqual({
      typeCheck: "tsc --noEmit",
      test: "vitest run",
      lint: "eslint .",
    });
  });

  it("returns partial commands when only some are configured", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith(".sprint.yml")
    );
    vi.mocked(readFileSync).mockReturnValue(
      `verification:\n  test: "pytest"\n`
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds).toEqual({ test: "pytest" });
  });

  it("auto-detects from package.json with npm (package-lock.json)", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("package-lock.json");
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        scripts: { test: "vitest run", "type-check": "tsc --noEmit", lint: "eslint ." },
      })
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.typeCheck).toBe("npm run type-check");
    expect(cmds.test).toBe("npm test");
    expect(cmds.lint).toBe("npm run lint");
  });

  it("auto-detects pnpm runner from pnpm-lock.yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("pnpm-lock.yaml");
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { test: "vitest run" } })
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.test).toBe("pnpm test");
  });

  it("auto-detects bun runner from bun.lockb", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("bun.lockb");
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { test: "bun test" } })
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.test).toBe("bun test");
  });

  it("auto-detects Rust project from Cargo.toml", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("Cargo.toml")
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.typeCheck).toBe("cargo check");
    expect(cmds.test).toBe("cargo test");
    expect(cmds.lint).toBe("cargo clippy -- -D warnings");
  });

  it("auto-detects Go project from go.mod", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("go.mod")
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.test).toBe("go test ./...");
    expect(cmds.typeCheck).toBe("go vet ./...");
  });

  it("returns empty commands when no project detected", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const cmds = loadVerificationCommands("/empty");
    expect(cmds).toEqual({});
  });

  it("prefers test:run over test when both exist", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("package-lock.json");
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { test: "vitest", "test:run": "vitest run" } })
    );

    const cmds = loadVerificationCommands("/project");
    expect(cmds.test).toBe("npm run test:run");
  });

  it(".sprint.yml takes precedence over auto-detection", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(".sprint.yml")) {
        return `verification:\n  test: "custom-test-runner"\n`;
      }
      return JSON.stringify({ scripts: { test: "vitest" } });
    });

    const cmds = loadVerificationCommands("/project");
    expect(cmds.test).toBe("custom-test-runner");
  });
});

describe("runVerification", () => {
  it("returns passed: true with empty results when no commands configured", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = await runVerification("/empty");
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });
});
