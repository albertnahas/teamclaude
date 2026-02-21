#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
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
    --global              Install to ~/.claude/ instead of ./.claude/
    --force               Overwrite existing files
    --template <name>     Init .sprint.yml from a pre-built template
    --template list       List all available templates

  General:
    --version, -v   Print version
    --help, -h      Show this help
`);
  process.exit(0);
}

// --- Template helpers ---

function listTemplateNames() {
  const dir = join(pkgRoot, "templates");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => basename(f, ".yml"));
  } catch {
    return [];
  }
}

/** Minimal YAML field extractor for sprint templates */
function parseTemplate(raw) {
  const lines = raw.split("\n");
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    // Block scalar: key: |
    const blockScalar = line.match(/^(\w[\w-]*):\s*\|$/);
    if (blockScalar) {
      const key = blockScalar[1];
      const indent = lines[i + 1]?.match(/^(\s+)/)?.[1]?.length ?? 2;
      const indentRe = new RegExp(`^ {${indent}}`);
      i++;
      const blockLines = [];
      while (i < lines.length) {
        const bl = lines[i];
        if (bl.trim() === "" || indentRe.test(bl)) {
          blockLines.push(bl.trim() === "" ? "" : bl.slice(indent));
          i++;
        } else {
          break;
        }
      }
      result[key] = blockLines.join("\n").trimEnd() + "\n";
      continue;
    }

    // Top-level scalar: key: value
    const scalar = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (scalar) {
      result[scalar[1]] = scalar[2].trim();
      i++;
      continue;
    }

    // Mapping key: key:
    const mappingKey = line.match(/^(\w[\w-]*):\s*$/);
    if (mappingKey) {
      const key = mappingKey[1];
      const nested = {};
      i++;
      while (i < lines.length) {
        const child = lines[i];
        if (/^\s*$/.test(child)) { i++; continue; }
        if (!/^\s/.test(child)) break;

        const listItem = child.match(/^\s+-\s+(.+)$/);
        if (listItem) {
          const listKey = Object.keys(nested).at(-1);
          if (listKey) (nested[listKey] ??= []).push(listItem[1].trim());
          i++;
          continue;
        }
        const nestedScalar = child.match(/^\s+(\w[\w-]*):\s*(.+)$/);
        if (nestedScalar) { nested[nestedScalar[1]] = nestedScalar[2].trim(); i++; continue; }
        const nestedListParent = child.match(/^\s+(\w[\w-]*):\s*$/);
        if (nestedListParent) { nested[nestedListParent[1]] = []; i++; continue; }
        i++;
      }
      result[key] = nested;
      continue;
    }

    i++;
  }
  return result;
}

function loadTemplate(name) {
  const path = join(pkgRoot, "templates", `${name}.yml`);
  if (!existsSync(path)) return null;
  try {
    return parseTemplate(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Build .sprint.yml content from a parsed template */
function buildSprintYml(parsed) {
  const agents = parsed.agents ?? {};
  const model = typeof agents.model === "string" ? agents.model : "sonnet";
  const roles = Array.isArray(agents.roles) ? agents.roles : [];
  const maxRounds = parsed.sprint?.max_review_rounds ?? "3";
  const cycles = parsed.cycles ?? "1";

  const rolesComment = roles.length
    ? `  # roles: ${roles.join(", ")} (${roles.length} agent${roles.length > 1 ? "s" : ""})`
    : "";

  return `# .sprint.yml — generated from ${parsed.name ?? "template"}
# See .sprint.example.yml for all available options.

agents:
  model: ${model}
${rolesComment ? rolesComment + "\n" : ""}
sprint:
  max_review_rounds: ${maxRounds}
  cycles: ${cycles}

verification:
  # type_check: "npm run type-check"
  # test: "npm test --run"
`;
}

if (command === "init") {
  const isGlobal = args.includes("--global");
  const force = args.includes("--force");
  const target = isGlobal ? join(homedir(), ".claude") : join(process.cwd(), ".claude");

  // Handle --template flag
  const templateFlagIdx = args.indexOf("--template");
  if (templateFlagIdx !== -1) {
    const templateName = args[templateFlagIdx + 1];
    const available = listTemplateNames();

    if (!templateName || templateName === "list") {
      if (available.length === 0) {
        console.log("No templates found.");
      } else {
        console.log("Available templates:");
        for (const name of available) {
          const parsed = loadTemplate(name);
          const desc = typeof parsed?.description === "string" ? ` — ${parsed.description}` : "";
          console.log(`  ${name}${desc}`);
        }
      }
      process.exit(0);
    }

    if (!available.includes(templateName)) {
      console.error(`Unknown template: "${templateName}"`);
      console.error(`Available: ${available.join(", ") || "(none)"}`);
      process.exit(1);
    }

    const parsed = loadTemplate(templateName);
    if (!parsed) {
      console.error(`Failed to load template: ${templateName}`);
      process.exit(1);
    }

    const sprintYmlPath = join(process.cwd(), ".sprint.yml");
    const sprintYml = buildSprintYml(parsed);
    writeFileSync(sprintYmlPath, sprintYml, "utf-8");

    const agents = parsed.agents ?? {};
    const roles = Array.isArray(agents.roles) ? agents.roles : [];
    const cycles = parsed.cycles ?? "1";

    console.log(`\nCreated .sprint.yml from "${templateName}" template`);
    if (typeof parsed.description === "string") {
      console.log(`${parsed.description}`);
    }
    console.log(`\nAgents: ${roles.join(", ") || "(none specified)"}`);
    console.log(`Cycles: ${cycles}`);

    if (typeof parsed.roadmap === "string") {
      console.log("\nRoadmap:\n");
      for (const line of parsed.roadmap.trimEnd().split("\n")) {
        console.log(`  ${line}`);
      }
    }

    console.log("\nRun `teamclaude start` to open the dashboard.");
    process.exit(0);
  }

  // Create .teamclaude/ directory with .gitignore for sprint history
  if (!isGlobal) {
    const tcDir = join(process.cwd(), ".teamclaude");
    if (!existsSync(tcDir)) {
      mkdirSync(tcDir, { recursive: true });
      writeFileSync(join(tcDir, ".gitignore"), "state.json\nanalytics.json\n", "utf-8");
      console.log("  created .teamclaude/ (sprint history directory)");
    }
  }

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
