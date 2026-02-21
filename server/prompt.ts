import type { RoleLearnings } from "./learnings.js";

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

export function compileSprintPrompt(
  roadmap: string,
  engineers: number,
  includePM: boolean,
  cycles: number,
  learnings?: RoleLearnings
): string {
  const teamName = `sprint-${Date.now()}`;
  const autoEngineers = engineers === 0;

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

  const engineerNames = autoEngineers
    ? []
    : engineers === 1
      ? ["sprint-engineer"]
      : Array.from({ length: engineers }, (_, i) => `sprint-engineer-${i + 1}`);

  const pmLearnings = learnings?.pm ? learningsSection("apply these improvements to task planning", learnings.pm) : "";
  const pmPrompt = `You are the PM for team "${teamName}".${roadmap.trim() ? `\n\nUser guidance:\n${roadmap}` : ""}${pmLearnings}

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

  const engineerList = engineerNames.length > 0
    ? `Available engineers: ${engineerNames.join(", ")}.`
    : "";
  const distributionRule = engineerNames.length > 1
    ? `\nIMPORTANT: Distribute tasks evenly across ALL engineers using round-robin. Do NOT assign all tasks to one engineer.`
    : "";
  const mgrLearnings = learnings?.manager ? learningsSection("apply these improvements to review and coordination", learnings.manager) : "";

  const mgrPromptAuto = `You are the Manager for team "${teamName}".
${engineerList}${mgrLearnings}

Your workflow:
1. Wait for the PM's "ROADMAP_READY" message
2. Call TaskList to see all created tasks
3. For each task: call TaskUpdate to set owner to an engineer name, then send "TASK_ASSIGNED: #id — subject" to that engineer
4. When an engineer sends "READY_FOR_REVIEW: #id", review their work thoroughly:
   - Verify the implementation matches the task description and acceptance criteria
   - Check that tests pass and type-checking is clean
   - Look for dead code, unused imports, or duplicate implementations
   - Verify no files were created that duplicate existing functionality
5. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — specific feedback" back
6. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}
CRITICAL: Use TaskUpdate for all status changes. Use TaskList to monitor progress.
IMPORTANT: Only send APPROVED when you have verified the work is correct. REQUEST_CHANGES with specific feedback is better than approving broken code.
${REFLECTION_INSTRUCTION}`;

  const mgrPromptManual = `You are the Manager for team "${teamName}".
${engineerList}${mgrLearnings}

Your workflow:
1. Call TaskList to see all created tasks
2. For each task: call TaskUpdate to set owner to an engineer name, then send "TASK_ASSIGNED: #id — subject" to that engineer
3. When an engineer sends "READY_FOR_REVIEW: #id", review their work thoroughly:
   - Verify the implementation matches the task description and acceptance criteria
   - Check that tests pass and type-checking is clean
   - Look for dead code, unused imports, or duplicate implementations
   - Verify no files were created that duplicate existing functionality
4. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — specific feedback" back
5. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}
CRITICAL: Use TaskUpdate for all status changes. Use TaskList to monitor progress.
IMPORTANT: Only send APPROVED when you have verified the work is correct. REQUEST_CHANGES with specific feedback is better than approving broken code.
${REFLECTION_INSTRUCTION}`;

  const engLearnings = learnings?.engineer ? learningsSection("apply these improvements to implementation", learnings.engineer) : "";
  const engPrompt = (name: string) => `You are engineer "${name}" for team "${teamName}".${engLearnings}

Your workflow:
1. Wait for "TASK_ASSIGNED: #id" messages from sprint-manager
2. Before writing new code, search the codebase for existing patterns, utilities, and components you can reuse. Do NOT create duplicates of existing functionality.
3. Implement the assigned task
4. Run the project's test/type-check commands to verify your changes work. Fix any failures before submitting.
5. Clean up: remove any dead code, unused imports, or temporary scaffolding you created
6. Send "READY_FOR_REVIEW: #id — summary of changes" to sprint-manager

IMPORTANT:
- Do NOT call TaskUpdate to set status to "completed" yourself. The system marks tasks completed when the manager approves.
- Always run tests before submitting for review. If the project has type-checking, run that too.
- Prefer editing existing files over creating new ones. Reuse existing patterns and abstractions.`;

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
      for (const name of engineerNames) {
        prompt += `
### ${name} (subagent_type: sprint-engineer)
Prompt:
"""
${engPrompt(name)}
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
      for (const name of engineerNames) {
        prompt += `
### ${name} (subagent_type: sprint-engineer, name: ${name})
Prompt:
"""
${engPrompt(name)}
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
