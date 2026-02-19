# TeamClaude

Autonomous sprint plugin for Claude Code. Orchestrates manager + engineer agent teams with real-time visualization.

## Install

**As a Claude Code plugin** (recommended):

```bash
# Add to your project
claude plugins add albertonahas/teamclaude

# Or install globally
claude plugins add --global albertonahas/teamclaude
```

**Via npm** (for the visualization server only):

```bash
npx teamclaude start
```

## Usage

### `/sprint` — Run a Sprint

**Manual mode** — you provide the roadmap:

```
/sprint Add user authentication, fix payment bug, refactor database layer
```

```
/sprint path/to/ROADMAP.md
```

**Autonomous mode** — PM agent analyzes the codebase and creates the roadmap:

```
/sprint
```

### Visualization Server

The sprint command automatically starts a real-time dashboard at `http://localhost:3456`:

- Live agent topology with status indicators
- Kanban board tracking all tasks
- Inter-agent message feed with protocol highlighting
- Phase and cycle indicators for autonomous mode

You can also run it standalone:

```bash
npx teamclaude start
npx teamclaude start --port 4000
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

The system is a **read-only observer** — it never writes to agent files. It watches Claude Code's native Agent Teams file system and streams events to the browser via WebSocket.

### Agent Roles

| Agent | Role |
|-------|------|
| **sprint-pm** | Analyzes codebase, creates roadmaps, validates results (autonomous mode only) |
| **sprint-manager** | Delegates tasks, reviews code, drives sprint to completion. Never writes code. |
| **sprint-engineer** | Implements features, fixes bugs, writes tests. Submits work for review. |

### Message Protocol

Agents communicate via prefixed messages:

| Prefix | Direction | Meaning |
|--------|-----------|---------|
| `TASK_ASSIGNED:` | Manager → Engineer | Task delegated |
| `READY_FOR_REVIEW:` | Engineer → Manager | Work submitted |
| `APPROVED:` | Manager → Engineer | Work accepted |
| `REQUEST_CHANGES:` | Manager → Engineer | Feedback (round N/3) |
| `ESCALATE:` | Either → Human | Stuck after 3 rounds |
| `ROADMAP_READY:` | PM → Manager | Sprint tasks created |
| `SPRINT_COMPLETE:` | Manager → PM | All tasks done |

## Configuration

TeamClaude auto-detects your project's package manager and commands. For explicit control, add `.sprint.yml` to your project root:

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

See [`.sprint.example.yml`](.sprint.example.yml) for all options.

## Architecture

```
teamclaude/
├── .claude-plugin/plugin.json   # Plugin manifest
├── agents/                      # Agent definitions
│   ├── sprint-manager.md
│   ├── sprint-engineer.md
│   └── sprint-pm.md
├── commands/sprint.md           # /sprint slash command
├── skills/sprint.md             # Skill trigger
├── server/                      # Visualization server
│   ├── index.ts                 # HTTP + WebSocket server
│   ├── watcher.ts               # File system watcher
│   ├── state.ts                 # Types + state management
│   ├── protocol.ts              # Message protocol detection
│   ├── prompt.ts                # Sprint prompt compilation
│   └── ui.html                  # Dashboard UI
└── bin/teamclaude.js            # CLI entry
```

## License

MIT
