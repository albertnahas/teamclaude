import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
}));

const { execFile } = await import("node:child_process");
const { createGist } = await import("./gist.js");

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockSuccess(stdout: string, stderr = "") {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], cb: Function) => cb(null, { stdout, stderr })
  );
}

function mockFailure(stderr: string, message = "Command failed") {
  const err: any = new Error(message);
  err.stderr = stderr;
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], cb: Function) => cb(err)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createGist", () => {
  it("returns the gist URL on success", async () => {
    mockSuccess("https://gist.github.com/user/abc123\n");
    const url = await createGist("# My Retro\n\nContent here", "retro.md");
    expect(url).toBe("https://gist.github.com/user/abc123");
  });

  it("invokes gh with --public and the temp file path", async () => {
    mockSuccess("https://gist.github.com/user/abc123\n");
    await createGist("content", "sprint-retro.md");
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["gist", "create", "--public"]),
      expect.any(Function)
    );
  });

  it("throws when gh is not installed (ENOENT)", async () => {
    const err: any = new Error("spawn gh ENOENT");
    err.stderr = "";
    err.code = "ENOENT";
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], cb: Function) => cb(err)
    );
    await expect(createGist("content", "retro.md")).rejects.toThrow("gh CLI is not installed");
  });

  it("throws when gh is not installed (command not found in stderr)", async () => {
    mockFailure("gh: command not found");
    await expect(createGist("content", "retro.md")).rejects.toThrow("gh CLI is not installed");
  });

  it("throws a friendly message when gh is not authenticated", async () => {
    mockFailure("To get started with GitHub CLI, please run: gh auth login\nnot logged in");
    await expect(createGist("content", "retro.md")).rejects.toThrow(
      "gh CLI is not authenticated"
    );
  });

  it("throws with stderr content on generic gh failure", async () => {
    mockFailure("failed to create gist: HTTP 422: Validation Failed");
    await expect(createGist("content", "retro.md")).rejects.toThrow(
      "failed to create gist: HTTP 422: Validation Failed"
    );
  });

  it("throws when stdout is not a https URL", async () => {
    mockSuccess("something unexpected\n");
    await expect(createGist("content", "retro.md")).rejects.toThrow("Unexpected gh output");
  });
});
