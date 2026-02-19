export const PROTOCOL_PATTERNS: Record<string, RegExp> = {
  TASK_ASSIGNED: /^TASK_ASSIGNED:/,
  READY_FOR_REVIEW: /^READY_FOR_REVIEW:/,
  APPROVED: /^APPROVED:/,
  REQUEST_CHANGES: /^REQUEST_CHANGES:/,
  RESUBMIT: /^RESUBMIT:/,
  ESCALATE: /^ESCALATE:/,
  ROADMAP_READY: /^ROADMAP_READY:/,
  SPRINT_COMPLETE: /^SPRINT_COMPLETE:/,
  CYCLE_COMPLETE: /^CYCLE_COMPLETE:/,
  ACCEPTANCE: /^ACCEPTANCE:/,
  NEXT_CYCLE: /^NEXT_CYCLE:/,
};

export function detectProtocol(content: string): string | undefined {
  for (const [name, re] of Object.entries(PROTOCOL_PATTERNS)) {
    if (re.test(content)) return name;
  }
  return undefined;
}

export function extractContent(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === "task_assignment") {
      return `TASK_ASSIGNED: ${parsed.taskId} — ${parsed.subject}`;
    }
    if (parsed.type === "idle_notification") {
      return `[idle: ${parsed.idleReason || "waiting"}]`;
    }
    if (parsed.type === "shutdown_request") {
      return `[shutdown requested]`;
    }
    return (
      parsed.text ||
      parsed.content ||
      parsed.summary ||
      parsed.message ||
      text
    );
  } catch {
    return text;
  }
}
