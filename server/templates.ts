import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as pathDirname } from "node:path";

// --- Types ---

export interface SprintTemplate {
  id: string; // filename without .yml
  name: string;
  description: string;
  agents: {
    roles: string[];
    model?: string;
  };
  cycles: number;
  roadmap: string;
}

// --- Paths ---

function templatesDir(): string {
  // Resolve relative to package root: templates/ lives next to server/
  const serverDir =
    typeof import.meta !== "undefined" && import.meta.url
      ? pathDirname(fileURLToPath(import.meta.url))
      : __dirname;
  return join(serverDir, "..", "templates");
}

// --- Minimal YAML parser ---
// Handles the simple structure used by sprint templates.
// Supports: top-level scalars, block scalars (|), nested list under agents.roles.

function parseTemplateYaml(raw: string): Record<string, unknown> {
  const lines = raw.split("\n");
  const result: Record<string, unknown> = {};

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comment-only lines
    if (/^\s*(#.*)?$/.test(line)) {
      i++;
      continue;
    }

    // Block scalar: key: |  (must be checked before generic scalar)
    const blockScalar = line.match(/^(\w[\w-]*):\s*\|$/);
    if (blockScalar) {
      const [, key] = blockScalar;
      const indent = lines[i + 1]?.match(/^(\s+)/)?.[1]?.length ?? 2;
      const indentRe = new RegExp(`^ {${indent}}`);
      i++;
      const blockLines: string[] = [];
      while (i < lines.length) {
        const bl = lines[i];
        // Accept blank lines or lines indented at least `indent` spaces
        if (bl.trim() === "" || indentRe.test(bl)) {
          blockLines.push(bl.trim() === "" ? "" : bl.slice(indent));
          i++;
        } else {
          break;
        }
      }
      result[key] = blockLines.join("\n").trimEnd() + "\n";
      continue;
    }

    // Top-level key: value (scalar)
    const scalar = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (scalar) {
      const [, key, value] = scalar;
      result[key] = value.trim();
      i++;
      continue;
    }

    // Mapping key with no inline value (e.g. "agents:" or "verification:")
    const mappingKey = line.match(/^(\w[\w-]*):\s*$/);
    if (mappingKey) {
      const [, key] = mappingKey;
      const nested: Record<string, unknown> = {};
      i++;
      // Collect indented children
      while (i < lines.length) {
        const child = lines[i];
        if (/^\s*(#.*)?$/.test(child)) { i++; continue; }
        if (!/^\s/.test(child)) break; // back to top level

        // List item under this key: "  - value"
        const listItem = child.match(/^\s+-\s+(.+)$/);
        if (listItem) {
          // Determine which sub-key owns this list by looking at preceding line
          const listKey = Object.keys(nested).at(-1);
          if (listKey) {
            (nested[listKey] as string[]).push(listItem[1].trim());
          }
          i++;
          continue;
        }

        // Nested scalar: "  key: value"
        const nestedScalar = child.match(/^\s+(\w[\w-]*):\s*(.+)$/);
        if (nestedScalar) {
          const [, nk, nv] = nestedScalar;
          nested[nk] = nv.trim();
          i++;
          continue;
        }

        // Nested key with no value (list parent): "  roles:"
        const nestedListParent = child.match(/^\s+(\w[\w-]*):\s*$/);
        if (nestedListParent) {
          const [, nk] = nestedListParent;
          nested[nk] = [];
          i++;
          continue;
        }

        i++;
      }
      result[key] = nested;
      continue;
    }

    i++;
  }

  return result;
}

function toTemplate(id: string, raw: string): SprintTemplate | null {
  const parsed = parseTemplateYaml(raw);

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const description =
    typeof parsed.description === "string" ? parsed.description.trim() : "";
  const cyclesRaw = parsed.cycles;
  const cycles =
    typeof cyclesRaw === "string"
      ? parseInt(cyclesRaw, 10)
      : typeof cyclesRaw === "number"
      ? cyclesRaw
      : NaN;
  const roadmap =
    typeof parsed.roadmap === "string" ? parsed.roadmap : "";

  const agentsRaw = parsed.agents as Record<string, unknown> | undefined;
  const roles = Array.isArray(agentsRaw?.roles)
    ? (agentsRaw.roles as string[])
    : [];
  const model =
    typeof agentsRaw?.model === "string" ? agentsRaw.model : undefined;

  // Validate required fields
  if (!name || !description || isNaN(cycles) || cycles < 1 || roles.length === 0) {
    return null;
  }

  return { id, name, description, agents: { roles, ...(model ? { model } : {}) }, cycles, roadmap };
}

// --- Public API ---

export function loadTemplates(): SprintTemplate[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  } catch {
    return [];
  }

  return files
    .map((file) => {
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        return toTemplate(basename(file, ".yml"), raw);
      } catch {
        return null;
      }
    })
    .filter((t): t is SprintTemplate => t !== null);
}

export function getTemplate(name: string): SprintTemplate | undefined {
  return loadTemplates().find((t) => t.id === name);
}
