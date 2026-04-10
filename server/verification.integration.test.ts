import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerification } from "./verification.js";

/**
 * Integration tests for runVerification using real subprocesses (no mocks).
 *
 * Regression guard for the bug where `next lint` — and any other command
 * that reads stdin interactively — would hang for 120s and silently revert
 * every APPROVED task back to in_progress. The fix closes the child's stdin
 * so interactive reads fail immediately.
 */
describe("runVerification integration", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "tc-verify-"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does not hang when a configured command reads stdin", async () => {
    // Script that blocks reading stdin. With stdin closed (our fix), Node sees
    // EOF immediately, the "end" handler fires, and the process exits code 0.
    // Without the fix, it would block until killed at the 120s timeout.
    writeFileSync(
      join(tmp, ".sprint.yml"),
      `verification:\n  type_check: "node -e process.stdin.resume().on('end',()=>process.exit(0))"\n`,
    );

    const start = Date.now();
    const result = await runVerification(tmp);
    const elapsed = Date.now() - start;

    expect(result.passed).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });

  it("captures non-zero exit as a failure with output", async () => {
    writeFileSync(
      join(tmp, ".sprint.yml"),
      `verification:\n  type_check: "node -e console.error('boom');process.exit(1)"\n`,
    );

    const result = await runVerification(tmp);
    expect(result.passed).toBe(false);
    expect(result.results[0].output).toContain("boom");
  });
});
