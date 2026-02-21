import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { statePath, ensureStorageDir } from "./storage.js";
import type { SprintState } from "./state.js";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSave(state: SprintState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureStorageDir();
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
    writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[persistence] Failed to flush state:", err.message);
  }
}

export function loadPersistedState(): Partial<SprintState> | null {
  const path = statePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Partial<SprintState>;
  } catch {
    return null;
  }
}
