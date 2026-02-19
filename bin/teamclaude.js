#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  teamclaude v${pkg.version}

  Autonomous sprint plugin for Claude Code

  Usage:
    teamclaude [start] [options]

  Commands:
    start           Start the visualization server (default)

  Options:
    --port <port>   Server port (default: 3456)
    --version, -v   Print version
    --help, -h      Show this help
`);
  process.exit(0);
}

// Filter out "start" command if present
const serverArgs = args.filter((a) => a !== "start");

// Import and run the server
const serverPath = join(__dirname, "..", "dist", "server.js");
process.argv = [process.argv[0], serverPath, ...serverArgs];
await import(serverPath);
