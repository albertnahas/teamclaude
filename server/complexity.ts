import type { TaskInfo } from "./state.js";

export interface ComplexityResult {
  score: number;
  tier: "simple" | "medium" | "complex";
  reason: string;
}

// Keywords that signal high-complexity work
const HIGH_COMPLEXITY_KEYWORDS = [
  "refactor",
  "migrate",
  "migration",
  "architecture",
  "worktree",
  "dashboard",
  "component library",
  "rewrite",
  "redesign",
  "integrate",
  "integration",
  "authentication",
  "authorization",
  "database",
  "schema",
  "pipeline",
  "infrastructure",
  "deployment",
  "multi-",
  "distributed",
  "concurrent",
  "async",
  "websocket",
  "streaming",
  "encryption",
  "security audit",
];

// Keywords that signal low-complexity work
const LOW_COMPLEXITY_KEYWORDS = [
  "add comment",
  "fix typo",
  "update readme",
  "rename",
  "update docs",
  "fix lint",
  "formatting",
  "whitespace",
  "changelog",
  "bump version",
  "update version",
  "cleanup",
  "remove unused",
  "add log",
  "minor fix",
  "typo",
];

// Patterns that suggest multiple files are involved
const MULTI_FILE_PATTERNS = [
  /\b(all|every|each)\s+(file|component|module|page|route|endpoint)/i,
  /\bmultiple\s+files?\b/i,
  /\bacross\s+the\s+(codebase|project|app)\b/i,
  /\bend[\s-]to[\s-]end\b/i,
  /\bfull[\s-]stack\b/i,
];

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateFileTouches(text: string): number {
  // Look for explicit file references (e.g. "server/index.ts", "*.ts")
  const fileRefs = (text.match(/[\w/-]+\.\w{2,4}/g) ?? []).length;

  // Count multi-file pattern matches
  const multiFileHits = MULTI_FILE_PATTERNS.filter((p) => p.test(text)).length;

  // Base estimate: at least 1 file, more if references exist
  return Math.max(1, fileRefs + multiFileHits * 2);
}

function scoreKeywords(text: string): number {
  const lower = text.toLowerCase();

  const highHits = HIGH_COMPLEXITY_KEYWORDS.filter((kw) =>
    lower.includes(kw)
  ).length;
  const lowHits = LOW_COMPLEXITY_KEYWORDS.filter((kw) =>
    lower.includes(kw)
  ).length;

  return highHits - lowHits;
}

function tierFromScore(score: number): "simple" | "medium" | "complex" {
  if (score <= 3) return "simple";
  if (score <= 7) return "medium";
  return "complex";
}

export function scoreTaskComplexity(task: TaskInfo): ComplexityResult {
  const text = [task.subject, task.description ?? ""].join(" ");
  const wordCount = countWords(text);
  const fileTouches = estimateFileTouches(text);
  const keywordDelta = scoreKeywords(text);

  const reasons: string[] = [];
  let rawScore = 5; // neutral baseline

  // --- Description length heuristic ---
  if (wordCount > 80) {
    rawScore += 2;
    reasons.push("long description");
  } else if (wordCount > 40) {
    rawScore += 1;
    reasons.push("moderate description length");
  } else if (wordCount < 15) {
    rawScore -= 1;
    reasons.push("short description");
  }

  // --- File touch estimate ---
  if (fileTouches >= 5) {
    rawScore += 2;
    reasons.push(`~${fileTouches} files referenced`);
  } else if (fileTouches >= 3) {
    rawScore += 1;
    reasons.push(`~${fileTouches} files referenced`);
  } else if (fileTouches === 1) {
    rawScore -= 1;
    reasons.push("single file");
  }

  // --- Keyword signals ---
  if (keywordDelta >= 2) {
    rawScore += 2;
    reasons.push("multiple high-complexity keywords");
  } else if (keywordDelta === 1) {
    rawScore += 1;
    reasons.push("high-complexity keyword");
  } else if (keywordDelta <= -1) {
    rawScore -= 2;
    reasons.push("low-complexity keyword");
  }

  // --- Blocked-by dependencies ---
  if (task.blockedBy.length >= 3) {
    rawScore += 2;
    reasons.push(`${task.blockedBy.length} dependencies`);
  } else if (task.blockedBy.length >= 1) {
    rawScore += 1;
    reasons.push(`${task.blockedBy.length} dependency`);
  }

  const score = Math.min(10, Math.max(1, rawScore));
  const tier = tierFromScore(score);
  const reason = reasons.length > 0 ? reasons.join(", ") : "default estimate";

  return { score, tier, reason };
}
