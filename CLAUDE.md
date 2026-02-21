# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                # Dev server with tsx (hot reload at http://localhost:3456)
npm run build              # Dashboard (Vite) → server/ui.html, then esbuild → dist/server.js
npm test                   # vitest run (all 220+ tests)
npm run test:watch         # vitest in watch mode
npx vitest run server/complexity.test.ts   # Run a single test file
npm run type-check         # tsc --noEmit (strict mode)
```

The dashboard build produces a **single-file HTML bundle** (`dashboard/ → server/ui.html`) via `vite-plugin-singlefile`. The server build then copies this into `dist/`.

## Architecture

TeamClaude is a **real-time sprint visualization server** for Claude Code agent teams. It observes agent activity by watching the filesystem and renders a live dashboard via WebSocket.

```
bin/teamclaude.js          CLI entry: init (scaffold plugin) | start (spawn server)
        │
        ▼
server/index.ts            HTTP + WebSocket server (port 3456)
├── state.ts               Shared SprintState singleton + WsEvent types + broadcast()
├── watcher.ts             Chokidar watches ~/.claude/teams/ and ~/.claude/tasks/
├── persistence.ts         Debounced save/load of state to .teamclaude/state.json
├── prompt.ts              Compiles sprint prompt for PM/manager/engineer agents
├── tmux.ts                Tmux session lifecycle + pane capture polling
├── protocol.ts            Detects message protocol tags (TASK_ASSIGNED, APPROVED, etc.)
├── planner.ts             Task dependency inference + execution ordering
├── model-router.ts        Task complexity → model selection (haiku/sonnet/opus)
├── retro.ts               Auto-generates sprint retrospective markdown
├── git.ts                 Sprint branch creation + PR summary
└── ui.html                Dashboard bundle (generated, do not edit directly)

dashboard/src/             React + TypeScript (Vite)
├── App.tsx                Main component: useReducer over WsEvent stream
├── hooks/useWebSocket.ts  Reconnecting WebSocket with exponential backoff
├── hooks/useTheme.ts      Dark/light mode toggle
└── components/            Pure, props-driven components
```

### Data Flow

1. Claude Code agent teams write to `~/.claude/teams/<team>/` and `~/.claude/tasks/<team>/`
2. Server's chokidar watchers detect file changes → parse JSON → update `state` singleton
3. Every state mutation calls `broadcast(event)` → pushes to all WebSocket clients
4. Dashboard receives WsEvent → React reducer updates UI
5. State is debounce-persisted (500ms) to `.teamclaude/state.json` for crash recovery

### Message Protocol

Agents communicate via inbox JSON files. The server detects structured prefixes:
- `TASK_ASSIGNED: #id` — marks task in_progress with owner
- `READY_FOR_REVIEW: #id` — triggers review cycle (or checkpoint gate)
- `APPROVED: #id` / `REQUEST_CHANGES: #id` — manager review flow
- `SPRINT_COMPLETE:` — ends sprint, triggers retro generation

Task IDs are extracted from messages via `/^[A-Z_]+:\s*#?(\d+)/`.

### Tmux Terminal Integration

When tmux is available, agents run in tmux panes instead of background processes. The server polls pane content every 300ms via `tmux capture-pane` and broadcasts `terminal_output` events. The dashboard renders these in an xterm.js widget. Tmux is optional — the server degrades gracefully without it.

## Key Conventions

- **ESM with .js extensions** — all local imports use `.js` suffix even in TypeScript (`import { state } from "./state.js"`)
- **State mutation = broadcast** — modify `state` directly, then call `broadcast(event)` which also triggers persistence
- **Terminal output excluded from persistence** — `terminal_output` and `panes_discovered` events skip the save debounce
- **Dashboard is generated** — edit files in `dashboard/src/`, not `server/ui.html`
- **Types are mirrored** — `server/state.ts` defines canonical types; `dashboard/src/types.ts` mirrors them for the frontend
- **Sprint templates** live in `templates/*.yml` and define agent roles, roadmap checklists, and model preferences

## Configuration

`.sprint.yml` (project-level, gitignored):
```yaml
agents:
  model: sonnet              # Default model for agents
sprint:
  max_review_rounds: 3
verification:
  type_check: "npm run type-check"
  test: "npm test"
server:
  port: 3456
models:
  overrides:
    "1": "claude-opus-4-6"   # Per-task model override
```

## Storage

Project-local data in `.teamclaude/` (gitignored via its own `.gitignore`):
- `state.json` — persisted sprint state for crash recovery
- `analytics.json` — sprint completion metrics across runs
- `learnings.md` — cross-sprint lessons fed back into prompts
- `history/<sprint-id>/` — per-sprint snapshots and retros
