# TeamClaude Roadmap

Prioritized roadmap to close competitive gaps and establish TeamClaude as the definitive sprint management layer for AI agent teams.

---

## Phase 1 — Foundation (v0.2) ✅

Production readiness and contributor enablement.

### 1.1 State Persistence ✅
- [x] Write sprint state to `~/.claude/teamclaude-state.json` on every mutation
- [x] Load state on server startup — resume interrupted sprints
- [x] Add `POST /api/resume` endpoint
- [x] Graceful shutdown handler to flush final state

### 1.2 Test Coverage ✅
- [x] Unit tests for `watcher.ts` — file event handling, protocol detection triggers, task state inference
- [x] Unit tests for `index.ts` — API endpoint responses, WebSocket event emission
- [x] Integration test: full sprint lifecycle (launch → assign → review → approve → stop)
- [ ] Target: 80%+ coverage on all server modules

### 1.3 CI/CD ✅
- [x] GitHub Actions workflow: lint, type-check, test on every PR
- [x] Automated npm publish on tagged releases
- [ ] Badge in README (build status, coverage, npm version)

### 1.4 Modular Architecture
- [ ] Extract from `watcher.ts`: `file-watcher.ts`, `protocol-detector.ts`, `task-state-machine.ts`, `token-tracker.ts`
- [ ] Define clear interfaces between modules
- [ ] Event emitter pattern for loose coupling

### 1.5 Contributor Infrastructure
- [ ] `CONTRIBUTING.md` — setup, architecture overview, PR guidelines, code style
- [ ] Issue templates (bug report, feature request, agent role proposal)
- [ ] PR template with checklist

---

## Phase 2 — Core Gaps (v0.3) ✅

Close the most impactful competitive gaps.

### 2.1 Git Worktree Isolation ✅
- [x] Each engineer agent gets its own git worktree (`sprint/<team>/engineer-<N>`)
- [x] Manager reviews diffs between worktrees
- [x] Auto-merge worktrees on task approval
- [x] Conflict detection with escalation to human
- [x] Cleanup worktrees on sprint stop

### 2.2 Multi-Model Routing ✅
- [x] Task complexity scoring (lines changed estimate, dependency count, file count)
- [x] Route simple tasks to Haiku, complex to Opus, default Sonnet
- [x] Per-task model override in `.sprint.yml`
- [x] Dashboard shows model used per task with cost comparison
- [x] "Cost saved by routing" metric in analytics

### 2.3 Sprint Planning Assistant ✅
- [x] Pre-sprint analysis: estimate task complexity, suggest breakdown, identify dependencies
- [x] Auto-set `blockedBy` relationships between tasks
- [x] Suggest parallel vs sequential execution order
- [x] Show plan in dashboard setup phase for user approval before launch

### 2.4 Extractable Dashboard ✅
- [x] Move `ui.html` to `dashboard/` as a proper Vite + React app
- [x] Component library: AgentTopology, TaskBoard, MessageFeed, TerminalView, Analytics
- [x] Theming support (light/dark, custom colors)
- [x] Build step produces single `dist/ui.html` for backward compatibility

---

## Phase 3 — Ecosystem (v0.4)

Community growth and extensibility.

### 3.1 Custom Agent Roles ⚠️
- [x] `agents/` directory as extension point — drop in any `*.md` agent definition
- [ ] Built-in roles beyond PM/Manager/Engineer: QA, DevOps, Security Auditor, Tech Writer
- [ ] Agent role registry in `.sprint.yml`:
  ```yaml
  agents:
    roles:
      - engineer
      - engineer
      - qa
  ```
- [ ] Dashboard renders custom roles with distinct colors/icons

### 3.2 Sprint Templates ✅
- [x] `templates/` directory with pre-built sprint types:
  - `bug-bash.yml` — triage and fix N bugs, QA agent verifies
  - `refactor.yml` — manager breaks down refactoring, engineer executes, tests must pass
  - `feature.yml` — PM writes spec, engineer implements, manager reviews
  - `security-audit.yml` — security agent scans, engineer fixes findings
- [ ] `npx teamclaude init --template bug-bash` scaffolding
- [x] Dashboard template picker in setup phase

### 3.3 Plugin API
- [ ] Event hooks: `onSprintStart`, `onTaskComplete`, `onEscalation`, `onSprintStop`
- [ ] Custom dashboard widgets via plugin manifest
- [ ] Custom protocol messages beyond the built-in 11
- [ ] Plugin directory in README

### 3.4 Example Sprints
- [ ] Recorded sprint sessions (anonymized) as JSON playback files
- [ ] `npx teamclaude replay <file>` — replay a sprint in the dashboard
- [ ] 3+ example sprints: small bug fix, medium feature, large refactor
- [ ] Link from README and docs

---

## Phase 4 — Integration (v0.5)

Connect to the tools teams already use.

### 4.1 GitHub Integration ⚠️
- [ ] Auto-create GitHub issues from sprint tasks (opt-in via `.sprint.yml`)
- [ ] Link PRs to tasks via commit message conventions
- [ ] Post retrospective as PR comment on sprint branch PR
- [ ] Sprint status check on PR (tasks completed/total)

*Existing: basic git support — sprint branches, PR summary generation*

### 4.2 Shareable Retrospectives ⚠️
- [ ] Export retro as GitHub gist (one command)
- [ ] Markdown + JSON export formats
- [ ] Retro diff: compare two sprints side by side
- [ ] Team velocity chart (SVG) embeddable in README/PR

*Existing: retro generation via `/api/retro`, saved to sprint history*

### 4.3 Sprint History Browser ✅
- [x] `GET /api/history` — paginated sprint history with filters
- [x] Dashboard history view: list past sprints, click to view retro
- [x] Velocity chart across sprints (completion rate, review rounds, token cost)
- [ ] Export history as CSV

### 4.4 Notifications
- [ ] Webhook support: POST events to external URLs (Slack, Discord, custom)
- [ ] Event types: sprint started, task escalated, sprint completed, checkpoint hit
- [ ] Configure in `.sprint.yml`:
  ```yaml
  notifications:
    webhook: https://hooks.slack.com/...
    events: [escalation, sprint_complete]
  ```

---

## Phase 5 — Scale (v1.0)

Production-grade for teams and enterprises.

### 5.1 Multi-Engineer Scaling ⚠️
- [x] Support 3-5 concurrent engineer agents with task queue
- [x] Manager load-balances assignments based on agent availability
- [x] Dashboard shows parallel progress lanes
- [ ] Token budget limits per sprint with auto-pause

### 5.2 Persistent Memory
- [ ] SQLite database for sprint state, analytics, and agent context
- [ ] Cross-sprint learning: "Last time task X took 3 review rounds, pre-check Y"
- [ ] Agent memory: engineer remembers codebase patterns across sprints
- [ ] Memory viewer in dashboard

### 5.3 Remote/Cloud Agents
- [ ] Support agents running in Docker containers or remote machines
- [ ] Agent discovery via network (not just local file system)
- [ ] Secure WebSocket tunneling for remote dashboards
- [ ] Self-hosted deployment guide

### 5.4 Multi-Provider Support
- [ ] Agent definitions can specify provider (Claude, GPT, Gemini)
- [ ] Unified protocol layer across providers
- [ ] Cost comparison across providers in analytics
- [ ] Fallback routing: if primary provider is down, use secondary

---

## Milestones

| Version | Target | Theme | Status |
|---------|--------|-------|--------|
| **v0.2** | Foundation | Persistence, tests, CI, modularity, contributor docs | ✅ Done (modularity + contributor docs remaining) |
| **v0.3** | Core Gaps | Git worktrees, model routing, planning assistant, extracted dashboard | ✅ Done |
| **v0.4** | Ecosystem | Custom roles, templates, plugin API, example sprints | ⚠️ In Progress (templates done, plugin API + replay remaining) |
| **v0.5** | Integration | GitHub, shareable retros, history browser, notifications | ⚠️ In Progress (history done, GitHub + webhooks remaining) |
| **v1.0** | Scale | Multi-engineer, persistent memory, remote agents, multi-provider | ⚠️ In Progress (multi-engineer done, memory + remote remaining) |

---

## Remaining Priority Order

| # | Item | Impact | Effort |
|---|------|--------|--------|
| 1 | Plugin API (3.3) | Extensibility — turns tool into platform | Medium |
| 2 | GitHub Integration (4.1) | Native feel in developer workflow | Medium |
| 3 | Notifications/Webhooks (4.4) | Team visibility (Slack/Discord) | Low |
| 4 | Custom Agent Roles (3.1) | Dynamic role loading from `.sprint.yml` | Medium |
| 5 | Shareable Retros (4.2) | Gist export, Markdown/JSON, velocity SVG | Low |
| 6 | Persistent Memory (5.2) | Cross-sprint learning — true differentiator | High |
| 7 | Example Sprints/Replay (3.4) | Onboarding & demos | Low |
| 8 | Modular Architecture (1.4) | Split `watcher.ts` — maintainability | Medium |
| 9 | Contributor Infrastructure (1.5) | Community enablement | Low |
| 10 | Token Budget Limits (5.1) | Cost guardrails | Low |
| 11 | Remote/Cloud Agents (5.3) | Enterprise scale | High |
| 12 | Multi-Provider (5.4) | GPT/Gemini support | High |
