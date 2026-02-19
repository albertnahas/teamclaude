#!/usr/bin/env node

import { readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8"));

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) || "start";

if (args.includes("--version") || args.includes("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  teamclaude v${pkg.version}

  Autonomous sprint plugin for Claude Code

  Usage:
    teamclaude [command] [options]

  Commands:
    start           Start the visualization server (default)
    init            Scaffold agents/commands/skills into .claude/

  Start options:
    --port <port>   Server port (default: 3456)

  Init options:
    --global        Install to ~/.claude/ instead of ./.claude/
    --force         Overwrite existing files

  General:
    --version, -v   Print version
    --help, -h      Show this help
`);
  process.exit(0);
}

if (command === "init") {
  const isGlobal = args.includes("--global");
  const force = args.includes("--force");
  const target = isGlobal ? join(homedir(), ".claude") : join(process.cwd(), ".claude");

  const copies = [
    { src: "agents/sprint-manager.md", dest: "agents/sprint-manager.md" },
    { src: "agents/sprint-engineer.md", dest: "agents/sprint-engineer.md" },
    { src: "agents/sprint-pm.md", dest: "agents/sprint-pm.md" },
    { src: "commands/sprint.md", dest: "commands/sprint.md" },
    { src: "skills/sprint.md", dest: "skills/sprint.md" },
  ];

  let installed = 0;
  let skipped = 0;

  for (const { src, dest } of copies) {
    const srcPath = join(pkgRoot, src);
    const destPath = join(target, dest);

    if (!existsSync(srcPath)) {
      console.warn(`  skip ${src} (not found in package)`);
      skipped++;
      continue;
    }

    if (existsSync(destPath) && !force) {
      console.log(`  skip ${dest} (exists, use --force to overwrite)`);
      skipped++;
      continue;
    }

    const isNew = !existsSync(destPath);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    console.log(`  ${isNew ? "created" : "updated"} ${dest}`);
    installed++;
  }

  // Copy .sprint.example.yml to project root (local only)
  if (!isGlobal) {
    const exSrc = join(pkgRoot, ".sprint.example.yml");
    const exDest = join(process.cwd(), ".sprint.example.yml");
    if (existsSync(exSrc) && (!existsSync(exDest) || force)) {
      copyFileSync(exSrc, exDest);
      console.log("  created .sprint.example.yml");
      installed++;
    }
  }

  console.log(`\nDone — ${installed} files installed, ${skipped} skipped`);
  if (installed > 0) {
    console.log(`Sprint agents installed to ${target}/`);
    console.log("Run /sprint in Claude Code to start a sprint.");
  }
  process.exit(0);
}

// Default: start server
const serverArgs = args.filter((a) => a !== "start");
const serverPath = join(__dirname, "..", "dist", "server.js");
process.argv = [process.argv[0], serverPath, ...serverArgs];
await import(serverPath);
