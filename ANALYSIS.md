# TeamClaude — Competitive Analysis & Open Source Strategy

## 1. Project Architecture

TeamClaude is an autonomous sprint plugin for Claude Code that orchestrates multi-agent teams with real-time visualization.

### Core Architecture

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

### Source Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `index.ts` | ~495 | HTTP + WebSocket server, API endpoints, process management, tmux launch |
| `watcher.ts` | ~408 | File system watcher (chokidar) — monitors team config, tasks, inbox; detects protocol patterns |
| `state.ts` | ~182 | Type definitions, global state, project detection, broadcast utilities |
| `retro.ts` | ~228 | Generates markdown retrospectives (summary, tasks, performance, velocity trends) |
| `tmux.ts` | ~156 | Tmux CLI wrappers — session/pane management, terminal capture polling, pane-to-agent mapping |
| `prompt.ts` | ~134 | Compiles orchestrator prompt for spawning agents with team names and role instructions |
| `analytics.ts` | ~83 | Records sprint completion data, loads history, calculates metrics |
| `git.ts` | ~74 | Creates sprint branches, generates PR summaries from commits |
| `protocol.ts` | ~44 | Pattern detection for 11 message protocol types |
| `ui.html` | ~89KB | Complete dashboard — setup phase, sprint phase, resizable panels, kanban, terminal, analytics |

### Agent Roles

| Agent | Role |
|-------|------|
| **sprint-pm** | Analyzes codebase, creates roadmaps, validates results. Never writes code. (Autonomous mode only) |
| **sprint-manager** | Delegates tasks, reviews code, drives sprint to completion. Never writes code. |
| **sprint-engineer** | Implements features, fixes bugs, writes tests. Submits work for review. |

### Sprint Modes

**Manual Mode** — user provides a roadmap:
```
/sprint Add user authentication, fix payment bug, refactor database layer
```
Tasks are parsed, shown for approval, then manager assigns to engineer(s) with code review rounds (max 3).

**Autonomous Mode** — PM agent drives:
```
/sprint
```
PM analyzes codebase (reads CLAUDE.md, runs tests, scans TODOs), creates prioritized roadmap, hands to manager. Runs in continuous cycles until no issues remain.

### Message Protocol

| Prefix | Direction | Meaning |
|--------|-----------|---------|
| `TASK_ASSIGNED` | Manager → Engineer | Task delegated with context |
| `READY_FOR_REVIEW` | Engineer → Manager | Work submitted for review |
| `APPROVED` | Manager → Engineer | Work accepted, task complete |
| `REQUEST_CHANGES` | Manager → Engineer | Feedback with round counter (N/3) |
| `RESUBMIT` | Engineer → Manager | Revised work after feedback |
| `ESCALATE` | Either → Human | Stuck after 3 rounds |
| `ROADMAP_READY` | PM → Manager | Sprint tasks created (autonomous) |
| `SPRINT_COMPLETE` | Manager → PM | All tasks done (autonomous) |
| `ACCEPTANCE` | PM → Manager | Validation pass/fail (autonomous) |
| `CYCLE_COMPLETE` | Manager → PM | Cycle finished (autonomous) |
| `NEXT_CYCLE` | PM → Manager | Starting next analysis (autonomous) |

### Dashboard Features

- Live agent topology nodes with active/idle pulse rings
- Task board (list or kanban view) with real-time status
- Protocol-tagged message feed (colored by type)
- Interactive tmux terminal per agent (xterm.js)
- Token cost tracking with per-model pricing (Haiku/Sonnet/Opus)
- Sprint analytics — historical completion rates, velocity trends
- Human checkpoints — pause before specific tasks
- Escalation alerts with dismiss controls
- Resizable panels, cycle/phase indicator, pause/stop

### State Management

Sprint state is held in-memory with the following shape:

- `teamName`, `projectName`, `mode` (manual/autonomous)
- `agents[]` — list of team members with status
- `tasks[]` — all tasks with id, subject, status, owner, blockedBy
- `messages[]` — agent messages with protocol detection
- `paused`, `escalation`, `cycle`, `phase`
- `tokenUsage` — total, byAgent, estimatedCostUsd
- `checkpoints[]`, `pendingCheckpoint`
- `tmuxAvailable`, `tmuxSessionName`

Updates flow through two channels: file system watching (source of truth) and protocol detection (inferred overrides).

### Analytics & Retrospectives

Sprint records persisted to `~/.claude/teamclaude-analytics.json`:
- Sprint ID, timestamps, cycle number
- Total/completed/blocked tasks
- Average review rounds per task
- Total messages, agent names

Auto-generated retrospective sections:
1. Sprint Summary (team, project, cycle, phase, duration)
2. Task Results (markdown table with status, owner, review rounds)
3. Team Performance (completion %, avg review rounds, message flow between agents)
4. Velocity Trend (this cycle vs previous, % change)
5. Agent Activity (messages sent/received per agent)

### Git Integration

- Auto-creates sprint branches: `sprint/<teamName>-cycle<N>`
- Generates PR summaries from commits between sprint branch and upstream
- Branch persisted after sprint for PR creation

### Project Detection

Auto-detects from lockfiles and package.json:
- pnpm, yarn, npm, bun, Cargo (Rust), go.mod (Go), pyproject.toml (Python)
- Reads `type-check` and `test` scripts from package.json
- Override with `.sprint.yml` for explicit control

---

## 2. Competitive Landscape

### Claude Flow (ruvnet/claude-flow)

- **Type:** Agent orchestration framework
- **Agents:** 64 specialized agents across 16 categories
- **Key features:** Spec-first approach (ADRs), stream-JSON chaining, SQLite persistent memory (`.swarm/memory.db`), 87 MCP tools
- **Performance:** 10-20x faster batch spawning, 84.8% SWE-Bench solve rate, 32.3% token reduction
- **Architecture:** Analyzes requests and routes to cheapest handler (WebAssembly for simple, cheaper models for medium, Opus for complex)
- **Open source:** Yes (v3, January 2026)
- **Strengths:** Enterprise-grade, persistent memory, multi-model routing, massive agent catalog
- **Weaknesses:** No sprint/project management concept, no real-time visualization dashboard, steep learning curve

### Claude Squad (smtg-ai/claude-squad)

- **Type:** CLI terminal multiplexer for AI agents
- **Key features:** Manages multiple AI terminal agents (Claude Code, Aider, Codex, OpenCode, Amp), specialized roles, inter-agent messaging
- **Architecture:** Each agent works in separate workspace with centralized task management
- **Installation:** Homebrew or manual (`cs` command)
- **Open source:** Yes
- **Strengths:** Agent-agnostic (works with any CLI agent), simple mental model
- **Weaknesses:** No visualization, no sprint workflow, no analytics, no code review process

### Claude Code Built-in Teams (TeamCreate, SendMessage)

- **Type:** Official built-in feature (experimental)
- **Key features:** 7+ core tools (TeamCreate, TaskCreate, SendMessage, TaskUpdate, etc.), shared task board with dependencies, inter-agent messaging
- **Architecture:** One session as team lead, teammates in separate context windows, file-system based coordination
- **Enabling:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var
- **Cost:** ~7x more tokens than standard sessions (each teammate is a separate Claude instance)
- **Strengths:** First-party, no dependencies, deep integration
- **Weaknesses:** No UI, no observability, no sprint workflow, no analytics, raw primitives only

### Oh My Claude Code (Yeachan-Heo/oh-my-claudecode)

- **Type:** Plugin with 32 specialized agents and 40+ skills
- **Key features:** Ultrapilot mode (5 concurrent workers, 3-5x faster), automatic model routing (Haiku for simple, Opus for complex — 30-50% token savings), Team as canonical orchestration surface
- **Architecture:** Auto-detects best mode and agents, intelligent task parallelization
- **Open source:** Proprietary plugin
- **Strengths:** Zero learning curve, model auto-routing, large agent catalog
- **Weaknesses:** Proprietary, no sprint management, no dashboard, no retrospectives

### Gas Town (steveyegge/gastown)

- **Type:** Go-based orchestrator on Beads framework
- **Key features:** 20-30 parallel agents via tmux, agent hierarchy (Mayor, Polecats, Witness, Deacon, Refinery)
- **Architecture:** Mayor (coordinator) orchestrates Polecat (executor) agents in parallel
- **Open source:** Yes (very experimental, "100% vibe coded")
- **Cost:** ~$100/hour burn rate
- **Strengths:** High parallelism, creative agent hierarchy
- **Weaknesses:** Extremely experimental, high cost, auto-merges failing tests, no sprint workflow

### Multiclaude (dlorenc/multiclaude)

- **Type:** Go-based team orchestrator
- **Key features:** Supervisor + subagent model, singleplayer (auto-merge) and multiplayer (human review) modes, custom subagents in Markdown
- **Architecture:** Supervisor delegates to subagents, automatic PR merging
- **Open source:** Yes
- **Strengths:** Simple model, good for team usage, auto-merge philosophy
- **Weaknesses:** No dashboard, no analytics, no sprint management, no code review rounds

### Claude Agentrooms (baryhuang/claude-code-by-agents)

- **Type:** Desktop app + API for multi-agent orchestration
- **Key features:** @mention task routing, intelligent task decomposition, mix local and remote agents
- **Website:** claudecode.run
- **Open source:** Yes
- **Strengths:** @mention routing, mixed agent support
- **Weaknesses:** Early stage, no sprint workflow, limited observability

### Augment Intent (augmentcode.com)

- **Type:** Spec-driven development workspace
- **Key features:** Living specs, coordinator + specialist + verifier agents, isolated git worktrees, unified workspace
- **Architecture:** Spec → Coordinator plans → Specialists execute in parallel → Verifier validates against spec
- **Model flexibility:** Works with Claude Code, Codex, OpenCode
- **Status:** Public beta
- **Strengths:** Spec-first, git worktree isolation, multi-provider, verifier agent
- **Weaknesses:** Proprietary, no sprint management, no retrospectives

### Cursor 2.0

- **Type:** Proprietary IDE
- **Key features:** Up to 8 parallel agents, git worktrees or remote sandboxes, multi-pane monitoring, architect/planner/implementation agents
- **Performance:** 4x faster than similar models, most tasks under 30 seconds
- **Pricing:** $20/month (Pro)
- **Strengths:** Best-in-class IDE integration, git worktree isolation, parallel exploration
- **Weaknesses:** Proprietary, IDE-locked, no sprint workflow, no analytics

### Windsurf (Codeium)

- **Type:** Proprietary IDE
- **Key features:** Cascade AI agent, 5 concurrent agents, git worktrees, multi-pane interface, dedicated zsh terminal
- **Pricing:** $15/month (Pro)
- **Strengths:** Deep codebase understanding, real-time awareness, parallel worktrees
- **Weaknesses:** Proprietary, IDE-locked, no sprint management

### Devin 2.0 (Cognition AI)

- **Type:** Cloud SaaS autonomous developer
- **Key features:** Multiple parallel instances in isolated VMs, Linear/Slack/Teams integration, 83% more tasks per ACU
- **Pricing:** $20/month Core, $2/ACU (~$9/hour), 96% price cut from $500
- **Strengths:** Fully autonomous, team integration, cloud-native
- **Weaknesses:** Cloud-only, no local control, no sprint workflow

### VS Code Copilot Agents

- **Type:** IDE extension
- **Key features:** Multi-agent HQ, supports Claude + Codex alongside Copilot, subagents for planning/implementation/review, background + cloud agents
- **Pricing:** Part of GitHub Copilot subscription ($10-20/month)
- **Strengths:** Multi-model, multi-agent in one IDE, large ecosystem
- **Weaknesses:** No sprint management, limited observability beyond IDE

### Warp Oz (warp.dev)

- **Type:** Cloud platform for agents at scale
- **Key features:** CLI/API/SDK, Docker environments, cron/webhook/API scheduling, git worktrees, self-hosted option
- **Architecture:** Agents run in Docker containers with centralized logging
- **Strengths:** Enterprise scale, cloud-native, self-hosted option, auditable
- **Weaknesses:** Infrastructure layer only — no sprint workflow, no code review process

---

## 3. Strategic Analysis

### What Makes TeamClaude Genuinely Different

#### Sprint-native abstraction

Every competitor focuses on spawning and coordinating agents. TeamClaude is the only tool that models the **actual software development lifecycle** — task assignment, code review rounds (max 3), escalation, retrospectives, velocity tracking.

| Tool | Abstraction Level |
|------|------------------|
| Claude Flow | Agent pipelines / DAGs |
| Claude Squad | Terminal multiplexer |
| Gas Town | Parallel worker pool |
| Multiclaude | PR assembly line |
| **TeamClaude** | **Sprint / Scrum workflow** |

#### Observability-first

Most competitors are headless. TeamClaude provides a full dashboard (agent topology, kanban board, protocol-tagged messages, interactive terminals, token costs, analytics). Only Cursor and Windsurf have comparable UIs, but those are proprietary IDE features.

#### Structured communication protocol

The 11-message protocol gives agents a predictable vocabulary. Competitors rely on free-form chat. TeamClaude's protocol makes agent behavior parseable, visualizable, and debuggable.

#### Human-in-the-loop controls

Checkpoints, escalation alerts, pause/resume — real project management controls. Not "let it rip."

#### Native Claude Code integration

Builds on Claude Code's official TeamCreate/TaskCreate/SendMessage primitives via file-system watching. Inherits every Claude Code improvement automatically.

#### Retrospectives and learning loops

No competitor generates sprint retrospectives with task results, team performance metrics, and velocity trends.

### Competitive Positioning

```
                    Low Observability ◄──────────► High Observability
                    │                                        │
High Automation ────┤  Gas Town        ┌─────────────────────┤
                    │  Multiclaude     │   Cursor 2.0        │
                    │                  │   Windsurf           │
                    │  Claude Flow     │                      │
                    │                  │   ★ TeamClaude       │
                    │  OMC             │                      │
Medium Automation ──┤                  │                      │
                    │  Claude Squad    │                      │
                    │                  │                      │
Low Automation ─────┤  Gemini CLI      │   VS Code Copilot   │
                    │  Claude Teams    │                      │
                    └──────────────────┴──────────────────────┘
```

TeamClaude occupies a unique quadrant: **high observability + high automation + sprint workflow**.

### Gaps vs. Competitors

| Gap | Who Does It Better |
|-----|-------------------|
| Multi-model routing (auto-pick Haiku vs Opus per task) | Oh My Claude Code, Claude Flow |
| Git worktree isolation (each agent in own branch) | Cursor 2.0, Windsurf, Augment Intent |
| Persistent memory (cross-session SQLite context) | Claude Flow (`.swarm/memory.db`) |
| Enterprise scale (20-30+ parallel agents) | Gas Town, Warp Oz |
| Cloud/remote agents (run in containers) | Warp Oz, Devin, Shipyard |
| Multi-provider (mix Claude + GPT + Gemini) | Augment Intent, Agentrooms |
| Spec-first workflow (living spec documents) | Augment Intent, Claude Flow (ADRs) |

### Internal Weaknesses

1. **Single-file UI** — `ui.html` is 89KB of inline code. Hard to maintain, impossible to theme or extend.
2. **No persistence across restarts** — state lives in memory; server crash loses sprint state.
3. **Missing test coverage** — watcher.ts and index.ts (the most complex modules) have zero tests.
4. **Tight coupling** — watcher.ts handles file watching, protocol detection, task inference, AND token tracking.
5. **No CI/CD** — no GitHub Actions, no automated test runs on PR.
6. **No contributor docs** — no CONTRIBUTING.md, no architecture decision records.

### Recommendations for Open Source Success

#### Positioning

Don't compete on "most agents" or "cheapest tokens." Own the **"sprint management for AI agent teams"** niche.

> "The missing project management layer for Claude Code teams."

#### Technical Priorities

1. **Extract UI into proper React app** — enable theming, plugins, community widgets
2. **Add state persistence** — write sprint state to disk (JSON/SQLite), survive restarts, enable "resume sprint"
3. **Improve test coverage** — watcher.ts is the heart and has no tests
4. **Add CI** — GitHub Actions for lint, type-check, test on every PR
5. **Modular architecture** — split watcher.ts into file-watcher, protocol-detector, task-state-machine, token-tracker
6. **Git worktree support** — each engineer agent gets an isolated worktree (table stakes in 2026)

#### Community & Ecosystem

1. **CONTRIBUTING.md** — setup instructions, architecture overview, PR guidelines
2. **Plugin API** — custom dashboard widgets, protocol messages, agent roles
3. **Example sprints** — recorded sessions showing the tool in action
4. **Custom agent roles** — QA, DevOps, Security Auditor via markdown definitions
5. **Sprint templates** — "Bug Bash," "Refactoring Sprint," "Feature Sprint," "Security Audit"

#### Strategic Features

1. **Sprint history browser** — view past sprints, compare velocity, track improvement
2. **Cost optimization** — suggest model downgrades for simple tasks
3. **Sprint planning assistant** — analyze roadmap, suggest task breakdown and dependencies
4. **GitHub integration** — auto-create issues from tasks, link PRs, post retros as comments
5. **Shareable retros** — export as GitHub gists or Slack posts
