/**
 * Sprint-complete guard — prevents race conditions where the PM
 * creates new-cycle tasks/roadmap after SPRINT_COMPLETE but before
 * shutdown is processed.
 *
 * Separate module to avoid circular deps between watcher ↔ task-state.
 */

let signaled = false;

export function isSprintComplete(): boolean { return signaled; }
export function setSprintComplete(): void { signaled = true; }
export function resetSprintCompleteFlag(): void { signaled = false; }
