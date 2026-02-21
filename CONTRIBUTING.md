# Contributing to TeamClaude

## Setup

```bash
git clone https://github.com/your-org/teamclaude.git
cd teamclaude
npm install
npm run dev          # dev server with hot reload at http://localhost:3456
npm test             # vitest run (all tests)
npm run type-check   # tsc --noEmit (strict mode)
```

The dashboard (`dashboard/`) is a Vite + React app. Changes to `dashboard/src/` are reflected immediately in dev mode via the Vite proxy. For production, `npm run build` compiles the dashboard into `server/ui.html` (single-file bundle via `vite-plugin-singlefile`), then bundles the server with esbuild into `dist/server.js`.

## Architecture Overview

```
bin/teamclaude.js          CLI entry: init | start | replay
        │
        ▼
server/index.ts            HTTP + WebSocket server (port 3456)
├── state.ts               Shared SprintState singleton + WsEvent types + broadcast()
├── watcher.ts             Chokidar watches ~/.claude/teams/ and ~/.claude/tasks/
├── http-handlers.ts       All HTTP route handlers (handleRequest dispatcher)
├── sprint-lifecycle.ts    Process/tmux launch and pane polling
├── persistence.ts         Debounced save/load of state to .teamclaude/state.json
├── prompt.ts              Compiles sprint prompt for PM/manager/engineer agents
├── protocol.ts            Detects message protocol tags (TASK_ASSIGNED, APPROVED, etc.)
├── planner.ts             Task dependency inference + execution ordering
├── model-router.ts        Task complexity → model selection (haiku/sonnet/opus)
├── retro.ts               Auto-generates sprint retrospective markdown
├── git.ts                 Sprint branch creation + PR summary
├── analytics.ts           Sprint completion recording and history
├── learnings.ts           Cross-sprint process learnings extraction
├── memory.ts              Persistent key-value memory store (.teamclaude/memories.json)
├── plugin-loader.ts       Plugin auto-discovery from .teamclaude/plugins/
├── github.ts              GitHub REST API integration (issues, PR comments)
├── notifications.ts       Outbound webhook dispatching
├── tmux.ts                Tmux session lifecycle + pane capture polling
├── budget.ts              Token budget limits with auto-pause
├── templates.ts           Sprint template loading from templates/
└── ui.html                Dashboard bundle (generated — edit dashboard/src/ instead)
```

**Data flow:**

1. Claude Code agent teams write to `~/.claude/teams/<team>/` and `~/.claude/tasks/<team>/`
2. `watcher.ts` chokidar watchers detect file changes → parse JSON → update `state` singleton
3. Every state mutation calls `broadcast(event)` → pushes `WsEvent` to all WebSocket clients
4. Dashboard receives `WsEvent` → React reducer in `App.tsx` updates UI
5. State is debounce-persisted (500ms) to `.teamclaude/state.json` for crash recovery

## Adding a New API Endpoint

1. **Add the handler** in `server/http-handlers.ts` — either inline or as a named function:

   ```typescript
   function handleMyFeature(req: IncomingMessage, res: ServerResponse) {
     res.writeHead(200, { "Content-Type": "application/json", ...CORS });
     res.end(JSON.stringify({ ok: true }));
   }
   ```

2. **Wire up the route** in `handleRequest()` in the same file:

   ```typescript
   } else if (url === "/api/my-feature" && req.method === "GET") {
     handleMyFeature(req, res);
   ```

3. **Add a WsEvent** (optional) if the endpoint mutates state that the dashboard should react to. Add the event type to `server/state.ts`:

   ```typescript
   // In WsEvent union:
   | { type: "my_event"; data: MyData }
   ```

   Then broadcast it: `broadcast({ type: "my_event", data })`.

4. **Add a test** in the appropriate `server/*.test.ts` file. For HTTP endpoints, follow the pattern in `server/index.test.ts` — spin up the server, make a fetch, assert the response.

## Adding a New Agent Role

1. **Create the agent definition** at `agents/<role>.md`. Include a YAML frontmatter block and a body describing the agent's responsibilities and workflow:

   ```markdown
   ---
   name: My Role
   ---
   You are a <role> agent. Your responsibilities are...

   Your workflow:
   1. Wait for TASK_ASSIGNED messages from sprint-manager
   2. Complete the task using your specialized skills
   3. Send READY_FOR_REVIEW: #id — summary to sprint-manager
   ```

2. **Add the role color** to `ROLE_COLORS` in `dashboard/src/components/AgentTopology.tsx`:

   ```typescript
   const ROLE_COLORS: Record<string, string> = {
     // existing entries...
     "my-role": "#a78bfa",  // violet
   };
   ```

   And add a match in `roleColor()`:

   ```typescript
   if (name.includes("my-role")) return ROLE_COLORS["my-role"];
   ```

3. **Reference the role** in `.sprint.yml` under `agents.roles`, or pass it via `--template` during `init`.

## Writing a Plugin

Plugins are auto-discovered from `.teamclaude/plugins/*.js` (ESM). Create a plugin file that exports a default object conforming to `TeamClaudePlugin`:

```javascript
// .teamclaude/plugins/logger.js
export default {
  name: "logger",
  hooks: {
    onSprintStart(state) {
      console.log(`[logger] Sprint started: team=${state.teamName}, tasks=${state.tasks.length}`);
    },
    onTaskComplete(task, state) {
      console.log(`[logger] Task #${task.id} completed: ${task.subject}`);
    },
    onSprintStop(state) {
      const done = state.tasks.filter(t => t.status === "completed").length;
      console.log(`[logger] Sprint ended. ${done}/${state.tasks.length} tasks completed.`);
    },
  },
};
```

Available hooks: `onSprintStart`, `onTaskComplete`, `onEscalation`, `onSprintStop`. All hooks are optional. Errors in plugins are caught and logged — they never crash the server.

## PR Guidelines

Before opening a PR, verify:

- [ ] `npm test` passes (all tests green)
- [ ] `npm run type-check` is clean (no TypeScript errors)
- [ ] No `console.log` in non-server code paths (dashboard components, pure utilities)
- [ ] New behavior has test coverage
- [ ] PR description includes: what changed and why, before/after for UI changes

Keep PRs focused — one feature or fix per PR. If you find unrelated issues while working, open a separate PR or issue.

## Code Style

- **ESM with `.js` extensions** — all local imports use `.js` suffix even in TypeScript source files:
  ```typescript
  import { state } from "./state.js";   // correct
  import { state } from "./state";      // wrong
  ```

- **No defensive coding** — validate at system boundaries (user input, external APIs); trust internal code and framework guarantees. Don't add guards for impossible states.

- **Absence over negation** — when something doesn't apply, omit it entirely. Don't explicitly state what isn't there.

- **State mutation = broadcast** — when you modify `state`, always follow it with `broadcast(event)`. The persistence debounce runs automatically on every broadcast.

- **Minimal diff** — make every change intentional. Don't refactor surrounding code unless it's directly related to your task.
