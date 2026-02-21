import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// --- Types ---

export interface Memory {
  id: string;
  role: string;
  key: string;
  value: string;
  sprintId: string | null;
  createdAt: number;
  accessCount: number;
  lastAccessed: number | null;
}

// --- Storage path ---

function memoriesPath(projectRoot: string): string {
  return join(projectRoot, ".teamclaude", "memories.json");
}

function ensureDir(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".teamclaude"), { recursive: true });
}

// --- Read/write helpers ---

export function loadMemories(projectRoot: string): Memory[] {
  const path = memoriesPath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Memory[];
  } catch {
    return [];
  }
}

function saveMemories(projectRoot: string, memories: Memory[]): void {
  ensureDir(projectRoot);
  writeFileSync(memoriesPath(projectRoot), JSON.stringify(memories, null, 2), "utf-8");
}

// --- Public API ---

export function saveMemory(
  projectRoot: string,
  role: string,
  key: string,
  value: string,
  sprintId: string | null = null
): Memory {
  const memories = loadMemories(projectRoot);
  const now = Date.now();

  // Upsert: if same role+key exists, update value
  const existing = memories.find((m) => m.role === role && m.key === key);
  if (existing) {
    existing.value = value;
    existing.sprintId = sprintId;
    saveMemories(projectRoot, memories);
    return existing;
  }

  const memory: Memory = {
    id: randomUUID(),
    role,
    key,
    value,
    sprintId,
    createdAt: now,
    accessCount: 0,
    lastAccessed: null,
  };
  memories.push(memory);
  saveMemories(projectRoot, memories);
  return memory;
}

export function getMemoriesForRole(
  projectRoot: string,
  role: string,
  limit = 20
): Memory[] {
  const all = loadMemories(projectRoot);
  const filtered = all.filter((m) => m.role === role);
  // Most recently accessed/created first
  filtered.sort((a, b) => (b.lastAccessed ?? b.createdAt) - (a.lastAccessed ?? a.createdAt));
  const result = filtered.slice(0, limit);
  // Increment accessCount on read
  const now = Date.now();
  const ids = new Set(result.map((m) => m.id));
  for (const m of all) {
    if (ids.has(m.id)) { m.accessCount += 1; m.lastAccessed = now; }
  }
  saveMemories(projectRoot, all);
  return result;
}

export function deleteMemory(projectRoot: string, id: string): boolean {
  const memories = loadMemories(projectRoot);
  const idx = memories.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  memories.splice(idx, 1);
  saveMemories(projectRoot, memories);
  return true;
}

export function searchMemories(projectRoot: string, query: string): Memory[] {
  const lower = query.toLowerCase();
  const all = loadMemories(projectRoot);
  const result = all.filter(
    (m) =>
      m.key.toLowerCase().includes(lower) ||
      m.value.toLowerCase().includes(lower) ||
      m.role.toLowerCase().includes(lower)
  );
  // Increment accessCount on read
  const now = Date.now();
  const ids = new Set(result.map((m) => m.id));
  for (const m of all) {
    if (ids.has(m.id)) { m.accessCount += 1; m.lastAccessed = now; }
  }
  saveMemories(projectRoot, all);
  return result;
}

/**
 * Format memories for injection into a prompt section.
 * Returns empty string when no memories exist for the role.
 */
export function formatMemoriesForPrompt(projectRoot: string, role: string): string {
  const memories = getMemoriesForRole(projectRoot, role, 10);
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
  return `\n\n## Persistent Memory\n${lines}`;
}
