---
name: sprint
description: Run an autonomous sprint with manager + engineer agents and real-time visualization
arguments:
  - name: input
    description: Either a file path to a roadmap (.md) or a plain-text description. Omit for fully autonomous PM-driven mode.
    required: false
---

# Sprint: Autonomous Development with Visualization

You are orchestrating an autonomous sprint. The mode depends on whether input was provided.

**If `$ARGUMENTS.input` is provided** → follow **Manual Mode** below (you parse the roadmap, create tasks, 2-agent sprint)
**If no arguments** → follow **Autonomous Mode** below (PM agent analyzes codebase, creates tasks, continuous 3-agent cycles)

---

## Step 0: Detect Project Context

Before starting the sprint, detect the project's tooling so agents use the correct commands.

### 0a. Check for `.sprint.yml`

Read `.sprint.yml` in the project root (if it exists). This provides explicit configuration:
```yaml
verification:
  type_check: "pnpm type-check"
  test: "pnpm test --run"
```

If `.sprint.yml` exists, use its values and skip auto-detection.

### 0b. Auto-detect Package Manager

Check which lockfile exists in the project root:
- `pnpm-lock.yaml` → **pnpm**
- `yarn.lock` → **yarn**
- `package-lock.json` → **npm**
- `bun.lockb` or `bun.lock` → **bun**
- None found → no package manager detected

### 0c. Auto-detect Commands

Read `package.json` scripts (if it exists):
- If `scripts.type-check` exists → type-check command is `{pm} type-check`
- If `scripts.typecheck` exists → type-check command is `{pm} typecheck`
- If neither → no type-check command (agents skip it)
- If `scripts.test` exists → test command is `{pm} test --run`
- If neither → no test command (agents skip it)

For non-JS projects (no `package.json`):
- Check for `Makefile` → `make test`, `make check`
- Check for `Cargo.toml` → `cargo check`, `cargo test`
- Check for `go.mod` → `go vet ./...`, `go test ./...`
- Check for `pyproject.toml` or `setup.py` → `pytest`

### 0d. Build Context String

Compose a context string to inject into agent spawn prompts:
```
The project uses {pm}. Type-check: `{type_check_cmd}`. Test: `{test_cmd}`.
```

If a command is unavailable, note it: "No type-check command available — skip type-check verification."

---

## Manual Mode

### Step 1: Parse Input

- If `$ARGUMENTS.input` ends in `.md` or `.txt` or is a valid file path → read it as a roadmap file
- Otherwise → treat it as an inline description of what to build

### Step 2: Break Down into Tasks

Parse the input into discrete tasks. The input can be in any format — the goal is to extract actionable work items:

**From a file:** Extract tasks from markdown. Look for numbered lists, bullet points, or headings. Each item becomes a task. Sub-items or indented text becomes the description.

**From plain text:** Break the natural language description into 2-8 focused tasks. Each task should be:
- Small enough to complete in one session
- Specific enough to implement without ambiguity
- Testable (you can verify it works)

**Detect dependencies naturally.** If the text says "needs X first", "after Y", "depends on Z", "requires the auth system" — infer the dependency from context. Match it to another task in the list.

### Step 3: Review with User

Present the plan using `AskUserQuestion`:

Format the question as:
```
Sprint Plan ({N} tasks):

  1. {subject}
     {description preview — first 80 chars}

  2. {subject}
     depends on: #1
     {description preview}

  ...

Ready to start?
```

Options:
- **Start sprint** — Launch immediately
- **Edit tasks** — User provides corrections, then re-present
- **Cancel** — Abort

If the user chooses "Edit tasks", gather their feedback, adjust the task list, and re-present. Repeat until they choose "Start sprint" or "Cancel".

### Step 4: Start Visualization Server

```bash
npx teamclaude start --port ${PORT:-3456} &
```

Save the PID and wait for startup:
```bash
echo $! > /tmp/sprint-visualizer.pid
sleep 2
```

Open the dashboard:
```bash
open http://localhost:${PORT:-3456}
```

### Step 5: Create Team

Use `TeamCreate` with:
- `team_name`: `sprint-YYYYMMDD-HHMM` (current date and time for uniqueness)
- `description`: Summary of the sprint scope (first task subject or user's description)

### Step 6: Create Tasks

For each task from the reviewed plan:

1. `TaskCreate` with:
   - `subject`: Concise imperative title (e.g., "Add dark mode toggle")
   - `description`: Full details, acceptance criteria, file hints
   - `activeForm`: Present continuous (e.g., "Adding dark mode toggle")

2. `TaskUpdate` with `addBlockedBy` for any dependencies detected in step 2.

### Step 7: Spawn Agents

Launch both agents using the `Task` tool with `run_in_background: true`:

**Sprint Manager:**
```
Task(
  subagent_type: "sprint-manager",
  team_name: "<team-name>",
  name: "sprint-manager",
  prompt: "You are the sprint manager for <team-name>. Check TaskList for available tasks and begin the sprint loop. Assign tasks to sprint-engineer one at a time, review their work, and drive to completion. The project is at <project-root>. <project-context>",
  mode: "bypassPermissions"
)
```

**Sprint Engineer:**
```
Task(
  subagent_type: "sprint-engineer",
  team_name: "<team-name>",
  name: "sprint-engineer",
  prompt: "You are the sprint engineer for <team-name>. Wait for task assignments from sprint-manager. When you receive a TASK_ASSIGNED message, implement the task, run verification, and submit for review. The project is at <project-root>. <project-context>",
  mode: "bypassPermissions"
)
```

Where `<project-context>` is the context string from Step 0d.

### Step 8: Send Kickoff

Send a message to `sprint-manager`:
```
Sprint started with {N} tasks. Check TaskList and begin assigning to sprint-engineer, starting with the lowest-ID unblocked task.
```

### Step 9: Monitor

Watch for incoming messages from agents:

**On `ESCALATE`:**
1. Show the escalation to the user with full context
2. Ask for their decision using `AskUserQuestion`
3. Relay the decision to the appropriate agent via `SendMessage`

**On sprint completion** (manager reports all tasks done):
1. Proceed to cleanup

### Step 10: Cleanup

1. Send `shutdown_request` to both agents
2. Wait for confirmations
3. `TeamDelete` to clean up team files
4. Kill the visualization server:
```bash
kill $(cat /tmp/sprint-visualizer.pid) 2>/dev/null
rm -f /tmp/sprint-visualizer.pid
```
5. Report results: tasks completed, tasks skipped, total review rounds, files changed

---

## Autonomous Mode

### Step A1: Start Visualization Server

```bash
npx teamclaude start --port ${PORT:-3456} &
```

Save the PID and wait for startup:
```bash
echo $! > /tmp/sprint-visualizer.pid
sleep 2
```

Open the dashboard:
```bash
open http://localhost:${PORT:-3456}
```

### Step A2: Create Team

Use `TeamCreate` with:
- `team_name`: `sprint-YYYYMMDD-HHMM` (current date and time for uniqueness)
- `description`: "Autonomous sprint — PM-driven continuous improvement"

### Step A3: Spawn Agents

Launch all three agents using the `Task` tool with `run_in_background: true`:

**Sprint PM:**
```
Task(
  subagent_type: "sprint-pm",
  team_name: "<team-name>",
  name: "sprint-pm",
  prompt: "You are the product manager for <team-name>. Analyze the codebase at <project-root> and create the first sprint roadmap. Follow your analysis protocol: read CLAUDE.md, check git log, run tests and type-check, scan for TODOs/FIXMEs. Create 3-8 prioritized tasks via TaskCreate, then send ROADMAP_READY to sprint-manager. <project-context>",
  mode: "bypassPermissions"
)
```

**Sprint Manager:**
```
Task(
  subagent_type: "sprint-manager",
  team_name: "<team-name>",
  name: "sprint-manager",
  prompt: "You are the sprint manager for <team-name>. This is a 3-agent autonomous sprint with a PM agent. Wait for ROADMAP_READY from sprint-pm before starting. When received, check TaskList and begin assigning tasks to sprint-engineer. After all tasks are done, send SPRINT_COMPLETE to sprint-pm and wait for the next cycle. The project is at <project-root>. <project-context>",
  mode: "bypassPermissions"
)
```

**Sprint Engineer:**
```
Task(
  subagent_type: "sprint-engineer",
  team_name: "<team-name>",
  name: "sprint-engineer",
  prompt: "You are the sprint engineer for <team-name>. Wait for task assignments from sprint-manager. When you receive a TASK_ASSIGNED message, implement the task, run verification, and submit for review. The project is at <project-root>. <project-context>",
  mode: "bypassPermissions"
)
```

Where `<project-context>` is the context string from Step 0d.

### Step A4: Send Kickoff

Send a message to `sprint-pm`:
```
Analyze the codebase and create the first sprint roadmap. The project is at <project-root>. Begin your analysis protocol.
```

### Step A5: Monitor

Watch for incoming messages from agents:

**On `ESCALATE`:**
1. Show the escalation to the user with full context
2. Ask for their decision using `AskUserQuestion`
3. Relay the decision to the appropriate agent via `SendMessage`

**Safety net — after 10 cycles** (track cycle count from PM's `ROADMAP_READY` messages):
1. Ask the user: "The PM has completed 10 sprint cycles. Continue?" using `AskUserQuestion`
   - **Continue** — Reset counter, send message to PM to continue
   - **Stop** — Proceed to cleanup

**On PM reporting no significant issues:**
1. Proceed to cleanup

### Step A6: Cleanup

1. Send `shutdown_request` to all three agents (`sprint-pm`, `sprint-manager`, `sprint-engineer`)
2. Wait for confirmations
3. `TeamDelete` to clean up team files
4. Kill the visualization server:
```bash
kill $(cat /tmp/sprint-visualizer.pid) 2>/dev/null
rm -f /tmp/sprint-visualizer.pid
```
5. Report results: cycles completed, tasks completed per cycle, total files changed
