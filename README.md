# TeamClaude

Autonomous sprint plugin for Claude Code. Orchestrates manager + engineer agent teams with a real-time visualization dashboard.

## Install

### Option A: npm (recommended)

```bash
npx teamclaude init        # Scaffold agents/commands/skills into .claude/
```

Then use `/sprint` in Claude Code.

### Option B: Plugin

```bash
claude plugins add albertnahas/teamclaude
```

Auto-registers agents, commands, and skills. Uses `npx teamclaude` for the server.

### Standalone server

```bash
npx teamclaude start
npx teamclaude start --port 4000
```

## Quick Start

### Manual Mode — you define the work

```
/sprint Add user authentication, fix payment bug, refactor database layer
```

Or point to a roadmap file:

```
/sprint path/to/ROADMAP.md
```

You'll be shown the parsed task list for approval before anything starts.

### Autonomous Mode — PM agent drives

```
/sprint
```

A PM agent analyzes the codebase (reads `CLAUDE.md`, runs tests, scans for TODOs), creates a prioritized roadmap, and hands it to the manager. Runs in continuous cycles until no issues remain.

## What Happens

1. **Project detection** — auto-detects package manager and verification commands from lockfile + `package.json`
2. **Visualization server** starts at `http://localhost:3456`
3. **Team created** — agents spawned with the detected project context
4. **Sprint loop** — manager assigns tasks to engineer(s), reviews code, approves or requests changes (max 3 rounds)
5. **Dashboard** streams everything live: agent topology, kanban board, message feed

### Dashboard Features

- Live agent nodes with active/idle status pulses
- Task board (list or kanban view) with real-time status updates
- Protocol-tagged message feed (TASK_ASSIGNED, READY_FOR_REVIEW, APPROVED, etc.)
- Cycle/phase indicator for autonomous mode
- Resizable panels, escalation alerts, pause/stop controls

## CLI Commands

```bash
npx teamclaude start [--port N]     # Start visualization server (default: 3456)
npx teamclaude init [--global] [--force]  # Scaffold into .claude/
npx teamclaude --version            # Print version
```

### `init` options

| Flag | Effect |
|------|--------|
| `--global` | Install to `~/.claude/` instead of `./.claude/` |
| `--force` | Overwrite existing files |

## Project Detection

The `/sprint` command auto-detects your project's tooling before spawning agents:

| Signal | Detection |
|--------|-----------|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `package-lock.json` | npm |
| `bun.lockb` | bun |
| `package.json` scripts | type-check + test commands |
| `Cargo.toml` | `cargo check` + `cargo test` |
| `go.mod` | `go vet` + `go test` |
| `pyproject.toml` | `pytest` |

For explicit control, add `.sprint.yml` to your project root:

```yaml
verification:
  type_check: "pnpm type-check"
  test: "pnpm test --run"

agents:
  model: sonnet

sprint:
  max_review_rounds: 3

server:
  port: 3456
```

## How It Works

```
~/.claude/teams/<team>/config.json     ──┐
~/.claude/teams/<team>/inboxes/*.json  ──┤  chokidar
~/.claude/tasks/<team>/*.json          ──┘  watches
                                           │
                                     ┌─────▼─────┐
                                     │   server   │
                                     │ HTTP + WS  │
                                     └─────┬──────┘
                                           │
                                     ┌─────▼─────┐
                                     │  browser   │
                                     │ dashboard  │
                                     └────────────┘
```

The server is a **read-only observer** — it never writes to agent files. It watches Claude Code's native Agent Teams file system and streams deltas to the browser via WebSocket.

### Agent Roles

| Agent | Role |
|-------|------|
| **sprint-pm** | Analyzes codebase, creates roadmaps, validates results. Never writes code. (Autonomous mode only) |
| **sprint-manager** | Delegates tasks, reviews code, drives sprint to completion. Never writes code. |
| **sprint-engineer** | Implements features, fixes bugs, writes tests. Submits work for review. |

### Message Protocol

Agents communicate via structured prefixed messages that the dashboard detects and highlights:

| Prefix | Direction | Meaning |
|--------|-----------|---------|
| `TASK_ASSIGNED:` | Manager → Engineer | Task delegated with context |
| `READY_FOR_REVIEW:` | Engineer → Manager | Work submitted for review |
| `APPROVED:` | Manager → Engineer | Work accepted, task complete |
| `REQUEST_CHANGES:` | Manager → Engineer | Feedback with round counter (N/3) |
| `RESUBMIT:` | Engineer → Manager | Revised work after feedback |
| `ESCALATE:` | Either → Human | Stuck after 3 rounds |
| `ROADMAP_READY:` | PM → Manager | Sprint tasks created (autonomous) |
| `SPRINT_COMPLETE:` | Manager → PM | All tasks done (autonomous) |
| `ACCEPTANCE:` | PM → Manager | Validation pass/fail (autonomous) |

## Architecture

```
teamclaude/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry
├── agents/
│   ├── sprint-manager.md       # Manager agent definition
│   ├── sprint-engineer.md      # Engineer agent definition
│   └── sprint-pm.md            # PM agent definition
├── commands/sprint.md          # /sprint slash command
├── skills/sprint.md            # Skill trigger
├── server/
│   ├── index.ts                # HTTP + WebSocket server (--port flag)
│   ├── watcher.ts              # File system watcher (chokidar)
│   ├── state.ts                # Types + state management
│   ├── protocol.ts             # Message protocol detection
│   ├── prompt.ts               # Sprint prompt compilation
│   └── ui.html                 # Dashboard UI (single-file, zero deps)
├── bin/teamclaude.js           # CLI entry point
└── .sprint.example.yml         # Example project config
```

## License

MIT
