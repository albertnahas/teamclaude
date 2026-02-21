<p align="center">
  <img src="assets/logo-512.png" alt="TeamClaude" width="120" />
</p>

<h1 align="center">TeamClaude</h1>

[![npm version](https://img.shields.io/npm/v/teamclaude)](https://www.npmjs.com/package/teamclaude)
[![CI](https://github.com/albertnahas/teamclaude/actions/workflows/ci.yml/badge.svg)](https://github.com/albertnahas/teamclaude/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Autonomous sprint plugin for Claude Code. Orchestrates manager + engineer agent teams with a real-time visualization dashboard.

## Prerequisites

### 1. Enable Agent Teams in Claude Code

Agent Teams is an **experimental feature** that must be enabled before use. Add to your `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or set the environment variable in your shell:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

> See the [official Agent Teams documentation](https://code.claude.com/docs/en/agent-teams) for full details.

### 2. Install tmux (recommended)

tmux enables live terminal views of each agent in the dashboard. Without it, agents run as background processes and terminal features are hidden.

```bash
# macOS
brew install tmux

# Ubuntu / Debian
sudo apt install tmux
```

### 3. Node.js 18+

```bash
node --version   # Must be >= 18
```

## Install

### Option A: npm (recommended)

```bash
npx teamclaude init        # Scaffold agents/commands/skills into .claude/
```

Then use `/sprint` in Claude Code.

### Option B: Plugin

```bash
claude plugin marketplace add albertnahas/teamclaude
claude plugin install teamclaude@teamclaude
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
- **Terminal view** — click any agent node to see their live tmux terminal output and send keystrokes
- Task board (list or kanban view) with real-time status updates
- Protocol-tagged message feed (TASK_ASSIGNED, READY_FOR_REVIEW, APPROVED, etc.)
- **Token cost tracking** — real-time token usage per agent with estimated USD cost (model-aware pricing)
- **Sprint analytics** — historical completion rates, review rounds, velocity trends across cycles
- **Retrospective** — auto-generated markdown retro on sprint stop (summary, task results, team performance)
- **Human checkpoints** — pause the sprint before specific tasks for manual review
- **Git integration** — auto-creates sprint branches (`sprint/<team>-cycleN`), generates PR summaries on stop
- Cycle/phase indicator for autonomous mode
- Resizable panels, escalation alerts, pause/stop controls

### Tmux Terminal Integration

When tmux is installed, agents launch inside a tmux session instead of a background process. This enables:

- **Live terminal view** — click any agent node in the dashboard to see their real-time terminal output (with ANSI color support via xterm.js)
- **Interactive input** — type directly in the terminal to send keystrokes to the agent's tmux pane
- **Pane-per-agent** — each agent gets its own tmux pane, auto-mapped when the team is discovered

If tmux is not installed, the dashboard works exactly as before — agents run as background processes and terminal features are hidden.

**Requirements:** `tmux` must be on PATH. Install via `brew install tmux` (macOS) or `apt install tmux` (Linux).

## CLI Commands

```bash
npx teamclaude start [--port N]                    # Start visualization server (default: 3456)
npx teamclaude init [--global] [--force]           # Scaffold agents/commands/skills into .claude/
npx teamclaude init --template <name>              # Init .sprint.yml from a pre-built template
npx teamclaude init --template list                # List available templates
npx teamclaude replay <file.jsonl> [--speed N]     # Replay a recorded sprint in the dashboard
npx teamclaude replay examples/small-bug-fix.jsonl # Try a bundled example replay
npx teamclaude --version                           # Print version
```

### `init` options

| Flag | Effect |
|------|--------|
| `--global` | Install to `~/.claude/` instead of `./.claude/` |
| `--force` | Overwrite existing files |
| `--template <name>` | Copy a pre-built template to `.sprint.yml` |
| `--template list` | List all available templates |

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
  model: sonnet    # haiku | sonnet | opus — affects token cost estimates

sprint:
  max_review_rounds: 3

server:
  port: 3456       # also configurable via --port flag
```

Token cost estimates use per-model pricing (haiku: $0.80/$4, sonnet: $3/$15, opus: $15/$75 per million input/output tokens). The model is read from `agents.model` in `.sprint.yml`, defaulting to sonnet.

## How It Works

```
~/.claude/teams/<team>/config.json     ──┐
~/.claude/teams/<team>/inboxes/*.json  ──┤  chokidar
~/.claude/tasks/<team>/*.json          ──┘  watches
                                           │
                                     ┌─────▼─────┐
              tmux (panes) ◄────────►│   server   │
              capture-pane           │ HTTP + WS  │
              send-keys              └─────┬──────┘
                                           │
                                     ┌─────▼─────┐
                                     │  browser   │
                                     │ xterm.js   │
                                     └────────────┘
```

The server watches Claude Code's native Agent Teams file system and streams deltas to the browser via WebSocket. When tmux is available, it also polls tmux panes for terminal output and relays keyboard input from the browser to agent panes via `send-keys`. On sprint stop, it records analytics to `~/.claude/teamclaude-analytics.json`, generates a retrospective, and creates a PR summary from the sprint branch.

### Agent Roles

| Agent | Role |
|-------|------|
| **sprint-pm** | Analyzes codebase, creates roadmaps, validates results. Never writes code. (Autonomous mode only) |
| **sprint-manager** | Delegates tasks, reviews code, drives sprint to completion. Never writes code. |
| **sprint-engineer** | Implements features, fixes bugs, writes tests. Submits work for review. |
| **sprint-qa** | Validates acceptance criteria, runs tests, reports defects. Never writes code. |
| **sprint-tech-writer** | Updates docs, changelogs, inline comments. Never writes code. |

Custom roles can be added by dropping an `agents/<role>.md` definition file and referencing it in `.sprint.yml`:

```yaml
agents:
  roles:
    - engineer
    - engineer
    - qa
    - tech-writer
```

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

## API

The server exposes a REST API alongside the WebSocket stream:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/state` | GET | Full sprint state snapshot |
| `/api/launch` | POST | Launch a sprint (`{ roadmap, engineers, includePM, cycles }`) |
| `/api/stop` | POST | Stop sprint, record analytics, generate retro + PR summary |
| `/api/pause` | POST | Toggle pause/resume |
| `/api/resume` | POST | Resume persisted sprint after server restart |
| `/api/process-status` | GET | Running process info (PID, startedAt) |
| `/api/analytics` | GET | Sprint history (`?cycle=N&limit=N&format=csv` filters) |
| `/api/retro` | GET | Last generated retrospective (`?format=json` for structured) |
| `/api/retro/gist` | POST | Publish retro to GitHub Gist, returns `{ url }` |
| `/api/retro/diff` | GET | Diff two sprints (`?a=<sprintId>&b=<sprintId>`) |
| `/api/history` | GET | List all sprint history entries |
| `/api/history/:id/retro` | GET | Retro for a specific past sprint |
| `/api/velocity.svg` | GET | Velocity chart SVG (`?w=N&h=N`) |
| `/api/plan` | GET | Task dependency analysis + model routing plan |
| `/api/plan/approve` | POST | Approve the pre-sprint plan |
| `/api/task-models` | GET | Model routing decision per task |
| `/api/git-status` | GET | Current branch + sprint branch status |
| `/api/checkpoint` | POST | Set a human checkpoint on a task (`{ taskId }`) |
| `/api/checkpoint/release` | POST | Release a pending checkpoint |
| `/api/dismiss-escalation` | POST | Dismiss an escalation alert |
| `/api/dismiss-merge-conflict` | POST | Dismiss a merge conflict alert |
| `/api/learnings` | GET | Process learnings from past sprints |
| `/api/process-learnings` | GET | Process learnings (alias) |
| `/api/process-learnings/:id` | DELETE | Remove a specific learning |
| `/api/memories` | GET | List persistent agent memories (`?role=X&q=query`) |
| `/api/memories` | POST | Save a memory (`{ role, key, value }`) |
| `/api/memories/:id` | DELETE | Delete a memory by ID |
| `/api/templates` | GET | List available sprint templates |

WebSocket events: `init`, `task_updated`, `message_sent`, `agent_status`, `token_usage`, `checkpoint`, `cycle_info`, `paused`, `escalation`, `process_started`, `process_exited`, `terminal_output`, `panes_discovered`, `merge_conflict`, `budget_warning`.

## Architecture

```
teamclaude/
├── .claude-plugin/
│   ├── plugin.json             # Plugin manifest
│   └── marketplace.json        # Marketplace registry
├── agents/
│   ├── sprint-manager.md       # Manager agent definition
│   ├── sprint-engineer.md      # Engineer agent definition
│   ├── sprint-pm.md            # PM agent definition
│   ├── qa.md                   # QA agent definition
│   └── tech-writer.md          # Tech Writer agent definition
├── commands/sprint.md          # /sprint slash command
├── skills/sprint.md            # Skill trigger
├── templates/                  # Pre-built sprint templates (bug-bash, feature, refactor, security-audit)
├── server/
│   ├── index.ts                # HTTP + WebSocket server entry
│   ├── http-handlers.ts        # All HTTP route handlers
│   ├── sprint-lifecycle.ts     # Process/tmux launch and pane polling
│   ├── watcher.ts              # Chokidar file watcher + protocol message handling
│   ├── state.ts                # SprintState singleton + WsEvent types + broadcast()
│   ├── protocol.ts             # Message protocol tag detection
│   ├── prompt.ts               # Sprint prompt compilation for all agent roles
│   ├── analytics.ts            # Sprint history recording and loading
│   ├── persistence.ts          # Debounced state save/load to .teamclaude/state.json
│   ├── storage.ts              # Storage path helpers
│   ├── git.ts                  # Sprint branch creation + PR summary generation
│   ├── retro.ts                # Auto-generated sprint retrospectives
│   ├── retro-diff.ts           # Side-by-side sprint comparison
│   ├── tmux.ts                 # Tmux session lifecycle + pane I/O
│   ├── model-router.ts         # Task complexity → model selection (haiku/sonnet/opus)
│   ├── planner.ts              # Task dependency inference + execution ordering
│   ├── learnings.ts            # Cross-sprint process learning extraction
│   ├── memory.ts               # Persistent key-value memory store
│   ├── plugin-loader.ts        # Plugin auto-discovery from .teamclaude/plugins/
│   ├── github.ts               # GitHub REST API (issues, PR comments)
│   ├── notifications.ts        # Outbound webhook dispatching
│   ├── budget.ts               # Token budget limits with auto-pause
│   ├── velocity.ts             # Velocity chart SVG generation
│   ├── gist.ts                 # GitHub Gist export
│   ├── verification.ts         # Post-task verification gate
│   ├── templates.ts            # Sprint template loading
│   ├── replay.ts               # Sprint replay event stream
│   ├── replay-server.ts        # HTTP server for sprint replay
│   └── ui.html                 # Dashboard bundle (generated — edit dashboard/src/)
├── dashboard/src/              # React + TypeScript dashboard (Vite)
├── bin/teamclaude.js           # CLI entry point
└── .sprint.example.yml         # Example project config
```

## Plugin API

Drop a `.js` file into `.teamclaude/plugins/` to hook into sprint lifecycle events:

```javascript
// .teamclaude/plugins/notify.js
export default {
  name: "notify",
  hooks: {
    onSprintStart(state) { console.log(`Sprint started: ${state.teamName}`); },
    onTaskComplete(task) { console.log(`Task done: ${task.subject}`); },
    onSprintStop(state) { console.log(`Sprint stopped`); },
  },
};
```

Available hooks: `onSprintStart`, `onTaskComplete`, `onEscalation`, `onSprintStop`. Errors in plugins are caught and logged — they never crash the server.

## Sprint Replay

Record a sprint by capturing the events from `/api/state`, then replay it in the dashboard:

```bash
npx teamclaude replay examples/bug-fix.json
npx teamclaude replay examples/bug-fix.json --speed 5   # 5× faster
```

## GitHub Integration

Opt in via `.sprint.yml` to auto-create GitHub issues from tasks and post retros as PR comments:

```yaml
github:
  repo: "your-org/your-repo"         # required
  pr_number: 42                       # optional — post retro to this PR
```

Set `GITHUB_TOKEN` in your environment. The token needs `issues:write` and `pull_requests:write` scopes.

## Token Budget

Prevent runaway token spend by setting a budget limit in `.sprint.yml`:

```yaml
budget:
  max_tokens: 100000      # auto-pause when total tokens exceed this
  warn_at: 80000          # show dashboard warning at this threshold
```

When the budget is hit, the sprint pauses and a warning appears in the dashboard. Resume with the Pause/Resume button after adjusting the budget or stopping the sprint.

## License

MIT
