import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RoleLearnings } from "./learnings.js";
import { formatMemoriesForPrompt } from "./memory.js";

// --- Custom role support ---

/**
 * Load the `agents.roles` array from `.sprint.yml`.
 * Returns null when not configured (caller falls back to numeric engineers param).
 */
export function loadCustomRoles(cwd: string = process.cwd()): string[] | null {
  const sprintYml = join(cwd, ".sprint.yml");
  if (!existsSync(sprintYml)) return null;

  let raw: string;
  try {
    raw = readFileSync(sprintYml, "utf-8");
  } catch {
    return null;
  }

  // Match the agents.roles block
  const agentsMatch = raw.match(/^agents\s*:\s*\n((?:[ \t]+\S[^\n]*\n?)*)/m);
  if (!agentsMatch) return null;

  const block = agentsMatch[1];
  const rolesBlockMatch = block.match(/[ \t]+roles\s*:\s*\n((?:[ \t]+-\s*.+\n?)*)/);
  if (!rolesBlockMatch) return null;

  const roles = rolesBlockMatch[1]
    .split("\n")
    .map((line) => line.replace(/^[ \t]+-\s*/, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return roles.length > 0 ? roles : null;
}

/**
 * Load agent definition markdown from `agents/<role>.md` relative to projectRoot.
 * Returns the body content (below the YAML frontmatter) if found, null otherwise.
 */
export function loadAgentDefinition(role: string, projectRoot: string = process.cwd()): string | null {
  // Normalize: "qa" → "qa", "sprint-qa" → "qa", "tech-writer" → "tech-writer"
  const normalized = role.replace(/^sprint-/, "");
  const agentPath = resolve(projectRoot, "agents", `${normalized}.md`);
  if (!existsSync(agentPath)) return null;

  try {
    const raw = readFileSync(agentPath, "utf-8");
    // Strip YAML frontmatter (--- ... ---)
    const bodyMatch = raw.match(/^---\n[\s\S]*?---\n([\s\S]*)$/);
    return bodyMatch ? bodyMatch[1].trim() : raw.trim();
  } catch {
    return null;
  }
}

// --- Helpers ---

function learningsSection(label: string, content: string): string {
  if (!content) return "";
  return `\n\nProcess learnings from past sprints — ${label}:\n${content}`;
}

function hasAnyLearnings(learnings?: RoleLearnings): boolean {
  if (!learnings) return false;
  return !!(learnings.orchestrator || learnings.pm || learnings.manager || learnings.engineer);
}

const REFLECTION_INSTRUCTION = `
Before sending SPRINT_COMPLETE, reflect on the sprint process. For each process improvement you identify, send:
  PROCESS_LEARNING: <role> — <actionable improvement>
where role is pm, manager, or engineer. Focus on meta-process, not technical details. Max 3 learnings.
Examples:
  PROCESS_LEARNING: pm — Task descriptions lacked file paths, causing engineers to waste time searching
  PROCESS_LEARNING: engineer — Code was submitted without running the type checker
  PROCESS_LEARNING: manager — I approved too quickly without verifying test output`;

// --- Custom role prompt builder ---

/**
 * Build a prompt section for a custom role agent.
 * Falls back to the engineer prompt format if no agent definition file exists.
 */
function customRolePrompt(
  role: string,
  name: string,
  teamName: string,
  projectRoot: string,
  engLearnings: string
): string {
  const definition = loadAgentDefinition(role, projectRoot);
  if (definition) {
    return `${definition}\n\nYou are "${name}" for team "${teamName}".${engLearnings}`;
  }

  // Generic fallback for unknown roles
  return `You are "${name}" (${role}) for team "${teamName}".${engLearnings}

Your workflow:
1. Wait for "TASK_ASSIGNED: #id" messages from sprint-manager
2. Before writing anything, search the codebase for relevant existing code and patterns
3. Complete the assigned task using your specialized skills
4. Verify your work
5. Send "READY_FOR_REVIEW: #id — summary of changes" to sprint-manager

IMPORTANT:
- Do NOT call TaskUpdate to set status to "completed" yourself
- Always verify your work before submitting for review`;
}

// --- Public API ---

export function compileSprintPrompt(
  roadmap: string,
  engineers: number,
  includePM: boolean,
  cycles: number,
  learnings?: RoleLearnings,
  roles?: string[],
  projectRoot: string = process.cwd()
): string {
  const teamName = `sprint-${Date.now()}`;
  const autoEngineers = engineers === 0 && !roles?.length;

  let prompt = `You are orchestrating a sprint. A visualization server is already running — do NOT start one.

IMPORTANT: You must do ALL work yourself. Do NOT spawn helper agents to create tasks or do any setup work. Only spawn the agents listed below.

First, call TeamCreate to create a team with team_name "${teamName}".
`;

  if (hasAnyLearnings(learnings) && learnings!.orchestrator) {
    prompt += `
## Process Learnings
${learnings!.orchestrator}
`;
  }

  // Resolve agent names: custom roles take precedence over numeric engineers
  const agentNames: { name: string; role: string }[] = [];

  if (roles && roles.length > 0) {
    // Count occurrences of each role to determine numbering
    const roleCounts = new Map<string, number>();
    const roleInstances = new Map<string, number>();

    for (const r of roles) {
      roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
    }

    for (const r of roles) {
      const count = roleCounts.get(r)!;
      const instance = (roleInstances.get(r) ?? 0) + 1;
      roleInstances.set(r, instance);

      // If only one of this role, use plain name; if multiple, number them
      const baseName = r.startsWith("sprint-") ? r : `sprint-${r}`;
      const name = count === 1 ? baseName : `${baseName}-${instance}`;
      agentNames.push({ name, role: r });
    }
  } else if (!autoEngineers) {
    const names =
      engineers === 1
        ? ["sprint-engineer"]
        : Array.from({ length: engineers }, (_, i) => `sprint-engineer-${i + 1}`);
    for (const n of names) agentNames.push({ name: n, role: "engineer" });
  }

  const engineerNames = agentNames.map((a) => a.name);

  // Load persistent memories for each role
  const pmMemories = formatMemoriesForPrompt(projectRoot, "pm");
  const mgrMemories = formatMemoriesForPrompt(projectRoot, "manager");
  const engMemories = formatMemoriesForPrompt(projectRoot, "engineer");

  const pmLearnings = learnings?.pm ? learningsSection("apply these improvements to task planning", learnings.pm) : "";
  const pmPrompt = `You are the PM for team "${teamName}".${roadmap.trim() ? `\n\nUser guidance:\n${roadmap}` : ""}${pmLearnings}${pmMemories}

Your workflow:
1. Analyze the codebase to understand existing patterns, architecture, and conventions
2. For EACH task, call the TaskCreate tool with:
   - A clear, specific subject (imperative form: "Add X", "Fix Y", "Refactor Z")
   - A description that includes: what to do, where in the codebase, and acceptance criteria (how to verify it's done)
3. Before creating tasks, check if existing code already partially solves the problem — avoid creating tasks for work that's already done
4. After creating all tasks, send ONE message to sprint-manager: "ROADMAP_READY: cycle 1, N tasks"
5. Then STOP and WAIT for the manager to signal completion

CRITICAL: You MUST call TaskCreate for every task. The visualization dashboard reads from TaskCreate — messages alone will NOT appear on the board.
IMPORTANT: Each task description MUST include acceptance criteria. Example: "Done when: tests pass, endpoint returns 200, no type errors."`;

  const agentListStr = engineerNames.length > 0
    ? `Available agents: ${engineerNames.join(", ")}.`
    : "";
  const distributionRule = engineerNames.length > 1
    ? `\nIMPORTANT: Distribute tasks evenly across ALL agents using round-robin. Do NOT assign all tasks to one agent.`
    : "";
  const mgrLearnings = learnings?.manager ? learningsSection("apply these improvements to review and coordination", learnings.manager) : "";

  const mgrPromptAuto = `You are the Manager for team "${teamName}".
${agentListStr}${mgrLearnings}${mgrMemories}

Your workflow:
1. Wait for the PM's "ROADMAP_READY" message
2. Call TaskList to see all created tasks
3. For each task: call TaskUpdate to set owner to an agent name, then send "TASK_ASSIGNED: #id — subject" to that agent
4. When an agent sends "READY_FOR_REVIEW: #id", begin reviewing RIGHT AWAY — the engineer is idle and blocked until you respond.
5. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — specific feedback" back
6. After APPROVED: immediately assign the next task in the SAME response — do not wait for acknowledgment. The server marks tasks completed automatically.
7. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}

## Mandatory Review Protocol (complete ALL steps IN ORDER before APPROVED)

1. Read the diff — identify changed files, understand what was modified.
2. Read the actual code — open and read the main files. Do NOT skip this step.
3. Run type-check — if errors, send REQUEST_CHANGES with error output.
4. Run tests — if failures, send REQUEST_CHANGES with failure output.
5. Verify acceptance criteria — re-read the task, confirm every criterion met.
6. If UI changes: grep the stylesheet for every new className. Missing = REQUEST_CHANGES.
7. If constants/config added: search for duplicates. Single source of truth.

Only after ALL steps pass may you send APPROVED.

WARNING: The server runs automated verification after every APPROVED. If type-check or tests fail, the task is reverted to in_progress. Rubber-stamping wastes review rounds.

CRITICAL: Use TaskUpdate for all status changes EXCEPT completing tasks — the server completes them automatically after APPROVED. Use TaskList to monitor progress.
Never call TaskUpdate to mark a task as completed. The server handles this.
${REFLECTION_INSTRUCTION}`;

  const mgrPromptManual = `You are the Manager for team "${teamName}".
${agentListStr}${mgrLearnings}${mgrMemories}

Your workflow:
1. Call TaskList to see all created tasks
2. For each task: call TaskUpdate to set owner to an agent name, then send "TASK_ASSIGNED: #id — subject" to that agent
3. When an agent sends "READY_FOR_REVIEW: #id", begin reviewing RIGHT AWAY — the engineer is idle and blocked until you respond.
4. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — specific feedback" back
5. After APPROVED: immediately assign the next task in the SAME response — do not wait for acknowledgment. The server marks tasks completed automatically.
6. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}

## Mandatory Review Protocol (complete ALL steps IN ORDER before APPROVED)

1. Read the diff — identify changed files, understand what was modified.
2. Read the actual code — open and read the main files. Do NOT skip this step.
3. Run type-check — if errors, send REQUEST_CHANGES with error output.
4. Run tests — if failures, send REQUEST_CHANGES with failure output.
5. Verify acceptance criteria — re-read the task, confirm every criterion met.
6. If UI changes: grep the stylesheet for every new className. Missing = REQUEST_CHANGES.
7. If constants/config added: search for duplicates. Single source of truth.

Only after ALL steps pass may you send APPROVED.

WARNING: The server runs automated verification after every APPROVED. If type-check or tests fail, the task is reverted to in_progress. Rubber-stamping wastes review rounds.

CRITICAL: Use TaskUpdate for all status changes EXCEPT completing tasks — the server completes them automatically after APPROVED. Use TaskList to monitor progress.
Never call TaskUpdate to mark a task as completed. The server handles this.
${REFLECTION_INSTRUCTION}`;

  const engLearnings = learnings?.engineer ? learningsSection("apply these improvements to implementation", learnings.engineer) : "";
  const engPrompt = (name: string) => `You are engineer "${name}" for team "${teamName}".${engLearnings}${engMemories}

Your workflow:
1. Wait for "TASK_ASSIGNED: #id" messages from sprint-manager
2. Before writing new code, search the codebase for existing patterns, utilities, and components you can reuse. Do NOT create duplicates of existing functionality.
3. Implement the assigned task
4. Run the pre-submit checklist below
5. Clean up: remove any dead code, unused imports, or temporary scaffolding you created
6. Send "READY_FOR_REVIEW: #id — summary of changes" to sprint-manager
7. STOP — your turn is done. Go idle and wait for the manager's response. Do NOT re-send READY_FOR_REVIEW.
8. When you receive APPROVED — task is done. Do NOT send any reply. Wait for the next TASK_ASSIGNED.

## Pre-submit checklist (run ALL before READY_FOR_REVIEW)
- [ ] Type-check passes clean
- [ ] All tests pass (existing + new)
- [ ] If you created/modified UI components: CSS exists for every className used. Check the stylesheet — if a class is missing, add it with proper styling matching existing theme.
- [ ] If you created/modified UI components: build succeeds (the dashboard compiles to a single bundle)
- [ ] If you added constants or config values: search the codebase first for existing definitions. Never duplicate data that exists elsewhere — import it.
- [ ] If you wrote tests: every external dependency is mocked. Tests must not read from disk, make network calls, or share mutable singletons across test files. Use afterEach cleanup for any shared state.
- [ ] If you used React hooks with object/function parameters: stabilize references with useRef or useMemo. Never pass inline object literals as useEffect dependencies.
- [ ] Race conditions: if code uses callbacks that null-ify shared state (event handlers, async completions), capture values in local variables before registering callbacks.

IMPORTANT:
- Do NOT call TaskUpdate to set status to "completed" yourself. The system marks tasks completed when the manager approves.
- Prefer editing existing files over creating new ones. Reuse existing patterns and abstractions.
- After sending READY_FOR_REVIEW, STOP. Do not re-send. Wait for the manager.
- When you receive APPROVED, do NOT send any response. Simply wait for the next TASK_ASSIGNED.`;

  if (includePM) {
    prompt += `
This is AUTONOMOUS mode. Spawn these agents using the Task tool. Use the EXACT prompts below for each agent.

### sprint-pm (subagent_type: sprint-pm)
Prompt:
"""
${pmPrompt}
"""

### sprint-manager (subagent_type: sprint-manager)
Prompt:
"""
${mgrPromptAuto}
"""
`;
    if (autoEngineers) {
      prompt += `
### Engineers
The manager determines how many engineers to spawn based on task complexity. For each engineer, spawn with subagent_type: sprint-engineer, named sprint-engineer-1, sprint-engineer-2, etc.
Engineer prompt template:
"""
${engPrompt("sprint-engineer-N")}
"""`;
    } else {
      for (const { name, role } of agentNames) {
        const isEngineer = role === "engineer" || role === "sprint-engineer";
        const agentType = isEngineer ? "sprint-engineer" : `sprint-${role.replace(/^sprint-/, "")}`;
        const agentPrompt = isEngineer
          ? engPrompt(name)
          : customRolePrompt(role, name, teamName, projectRoot, engLearnings);
        prompt += `
### ${name} (subagent_type: ${agentType})
Prompt:
"""
${agentPrompt}
"""
`;
      }
    }

    if (cycles > 1) {
      prompt += `

## Sprint Cycles (${cycles} total)
After each cycle, the manager sends "CYCLE_COMPLETE: cycle N" to the PM. The PM then analyzes results, creates new tasks for the next cycle, and sends a new "ROADMAP_READY". Run exactly ${cycles} cycles.`;
    }
  } else {
    prompt += `
This is MANUAL mode. Follow these steps IN ORDER. You have access to TaskCreate after calling TeamCreate.

## Step 1: Create ALL tasks yourself
After TeamCreate, call TaskCreate once per task. Parse the roadmap below and create one task for each item. You MUST do this yourself — do NOT spawn any agent to create tasks for you.

## Step 2: Spawn ONLY these agents
After ALL tasks exist, spawn ONLY the agents listed below. No other agents.

### sprint-manager (subagent_type: sprint-manager, name: sprint-manager)
Prompt:
"""
${mgrPromptManual}
"""
`;
    if (autoEngineers) {
      prompt += `
### Engineers
The manager determines how many engineers to spawn. Name them sprint-engineer-1, sprint-engineer-2, etc. subagent_type: sprint-engineer.
Engineer prompt template:
"""
${engPrompt("sprint-engineer-N")}
"""`;
    } else {
      for (const { name, role } of agentNames) {
        const isEngineer = role === "engineer" || role === "sprint-engineer";
        const agentType = isEngineer ? "sprint-engineer" : `sprint-${role.replace(/^sprint-/, "")}`;
        const agentPrompt = isEngineer
          ? engPrompt(name)
          : customRolePrompt(role, name, teamName, projectRoot, engLearnings);
        prompt += `
### ${name} (subagent_type: ${agentType}, name: ${name})
Prompt:
"""
${agentPrompt}
"""
`;
      }
    }

    prompt += `

## Step 3: Monitor
After spawning all agents, wait for the manager to send "SPRINT_COMPLETE". Then you are done.

## Roadmap
${roadmap}`;
  }

  return prompt;
}
