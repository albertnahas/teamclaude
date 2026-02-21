#!/usr/bin/env node

/**
 * Dev-only: symlink/unsymlink local repo into the Claude Code plugin system.
 *
 *   node scripts/dev-link.js link
 *   node scripts/dev-link.js unlink
 */

import { existsSync, lstatSync, rmSync, symlinkSync, readlinkSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8"));

const PLUGIN_NAME = "teamclaude";
const pluginsDir = join(homedir(), ".claude", "plugins");
const marketplacePath = join(pluginsDir, "marketplaces", PLUGIN_NAME);
const cachePath = join(pluginsDir, "cache", PLUGIN_NAME, PLUGIN_NAME, pkg.version);

const action = process.argv[2];

function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function getGitRemote() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { cwd: pkgRoot, encoding: "utf-8" }).trim();
  } catch { return null; }
}

if (action === "link") {
  if (isSymlink(marketplacePath) && readlinkSync(marketplacePath) === pkgRoot) {
    console.log("Already linked.");
    process.exit(0);
  }

  for (const target of [marketplacePath, cachePath]) {
    if (existsSync(target)) rmSync(target, { recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(pkgRoot, target);
  }

  console.log(`Linked ${pkgRoot} ->`);
  console.log(`  ${marketplacePath}`);
  console.log(`  ${cachePath}`);
  console.log("\nLocal changes are now live in the plugin system.");
} else if (action === "unlink") {
  if (!isSymlink(marketplacePath) && !isSymlink(cachePath)) {
    console.log("Not linked — nothing to do.");
    process.exit(0);
  }

  const remote = getGitRemote();

  for (const target of [marketplacePath, cachePath]) {
    if (isSymlink(target)) rmSync(target);
  }

  if (remote) {
    console.log(`Re-cloning from ${remote}...`);
    try {
      execFileSync("git", ["clone", "--depth", "1", remote, marketplacePath], { stdio: "inherit" });
      console.log(`Cloned to ${marketplacePath}`);
    } catch {
      console.error("Clone failed — plugin will re-install on next Claude Code plugin update.");
    }
  } else {
    console.log("No git remote found — removed symlinks only.");
    console.log("Plugin will re-install on next Claude Code plugin update.");
  }
} else {
  console.log("Usage: node scripts/dev-link.js <link|unlink>");
  process.exit(1);
}
