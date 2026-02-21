import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Creates a public GitHub Gist using the `gh` CLI.
 * Returns the gist URL on success.
 * Throws an Error with a descriptive message on failure.
 */
export async function createGist(content: string, filename: string): Promise<string> {
  const tmpFile = join(tmpdir(), filename);

  await writeFile(tmpFile, content, "utf-8");

  try {
    const { stdout } = await execFileAsync("gh", ["gist", "create", "--public", tmpFile]);
    const url = stdout.trim();
    if (!url.startsWith("https://")) {
      throw new Error(`Unexpected gh output: ${url}`);
    }
    return url;
  } catch (err: any) {
    const msg: string = err.stderr ?? err.message ?? String(err);
    if (
      err.code === "ENOENT" ||
      msg.includes("command not found") ||
      msg.includes("ENOENT")
    ) {
      throw new Error("gh CLI is not installed");
    }
    if (msg.includes("not logged in") || msg.includes("authentication") || msg.includes("401")) {
      throw new Error("gh CLI is not authenticated — run `gh auth login`");
    }
    throw new Error(msg.trim() || "gh gist create failed");
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
