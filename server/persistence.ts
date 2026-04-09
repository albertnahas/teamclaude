import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { statePath, ensureStorageDir } from "./storage.js";
import type { SprintState } from "./state.js";
import { taskProtocolOverrides, inboxCursors } from "./state.js";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Snapshot in-memory Maps into serializable state fields before writing. */
function snapshotMaps(state: SprintState) {
  state.taskProtocolOverridesJSON = Object.fromEntries(taskProtocolOverrides);
  state.inboxCursorsJSON = Object.fromEntries(inboxCursors);
}

export function scheduleSave(state: SprintState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureStorageDir();
      snapshotMaps(state);
      writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
    } catch (err: any) {
      console.error("[persistence] Failed to save state:", err.message);
    }
  }, 500);
}

export function flushSave(state: SprintState) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    ensureStorageDir();
    snapshotMaps(state);
    writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[persistence] Failed to flush state:", err.message);
  }
}

export function loadPersistedState(): Partial<SprintState> | null {
  const path = statePath();
  if (!existsSync(path)) return null;
  try {
    const loaded = JSON.parse(readFileSync(path, "utf-8")) as Partial<SprintState>;

    // Restore in-memory Maps from persisted JSON
    if (loaded.taskProtocolOverridesJSON) {
      taskProtocolOverrides.clear();
      for (const [k, v] of Object.entries(loaded.taskProtocolOverridesJSON)) {
        taskProtocolOverrides.set(k, v);
      }
    }
    if (loaded.inboxCursorsJSON) {
      inboxCursors.clear();
      for (const [k, v] of Object.entries(loaded.inboxCursorsJSON)) {
        inboxCursors.set(k, v);
      }
    }

    return loaded;
  } catch {
    return null;
  }
}
