export function compileSprintPrompt(
  roadmap: string,
  engineers: number,
  includePM: boolean,
  cycles: number
): string {
  const teamName = `sprint-${Date.now()}`;
  const autoEngineers = engineers === 0;

  let prompt = `You are orchestrating a sprint. A visualization server is already running — do NOT start one.

IMPORTANT: You must do ALL work yourself. Do NOT spawn helper agents to create tasks or do any setup work. Only spawn the agents listed below.

First, call TeamCreate to create a team with team_name "${teamName}".
`;

  const engineerNames = autoEngineers
    ? []
    : engineers === 1
      ? ["sprint-engineer"]
      : Array.from({ length: engineers }, (_, i) => `sprint-engineer-${i + 1}`);

  const pmPrompt = `You are the PM for team "${teamName}".${roadmap.trim() ? `\n\nUser guidance:\n${roadmap}` : ""}

Your workflow:
1. Analyze the codebase to identify what needs to be done
2. For EACH task, call the TaskCreate tool with a clear subject and description
3. After creating all tasks, send ONE message to sprint-manager: "ROADMAP_READY: cycle 1, N tasks"
4. Then STOP and WAIT for the manager to signal completion

CRITICAL: You MUST call TaskCreate for every task. The visualization dashboard reads from TaskCreate — messages alone will NOT appear on the board.`;

  const engineerList = engineerNames.length > 0
    ? `Available engineers: ${engineerNames.join(", ")}.`
    : "";
  const distributionRule = engineerNames.length > 1
    ? `\nIMPORTANT: Distribute tasks evenly across ALL engineers using round-robin. Do NOT assign all tasks to one engineer.`
    : "";

  const mgrPromptAuto = `You are the Manager for team "${teamName}".
${engineerList}

Your workflow:
1. Wait for the PM's "ROADMAP_READY" message
2. Call TaskList to see all created tasks
3. For each task: call TaskUpdate to set owner to an engineer name, then send "TASK_ASSIGNED: #id — subject" to that engineer
4. When an engineer sends "READY_FOR_REVIEW: #id", review their work
5. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — feedback" back
6. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}
CRITICAL: Use TaskUpdate for all status changes. Use TaskList to monitor progress.`;

  const mgrPromptManual = `You are the Manager for team "${teamName}".
${engineerList}

Your workflow:
1. Call TaskList to see all created tasks
2. For each task: call TaskUpdate to set owner to an engineer name, then send "TASK_ASSIGNED: #id — subject" to that engineer
3. When an engineer sends "READY_FOR_REVIEW: #id", review their work
4. Send "APPROVED: #id" or "REQUEST_CHANGES: #id — feedback" back
5. When ALL tasks have status completed, send "SPRINT_COMPLETE" to team-lead
${distributionRule}
CRITICAL: Use TaskUpdate for all status changes. Use TaskList to monitor progress.`;

  const engPrompt = (name: string) => `You are engineer "${name}" for team "${teamName}".

Your workflow:
1. Wait for "TASK_ASSIGNED: #id" messages from sprint-manager
2. Implement the assigned task
3. Call TaskUpdate to set task status to "completed"
4. Send "READY_FOR_REVIEW: #id — summary of changes" to sprint-manager

CRITICAL: After finishing work, you MUST call TaskUpdate with status "completed" before sending the review message.`;

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
