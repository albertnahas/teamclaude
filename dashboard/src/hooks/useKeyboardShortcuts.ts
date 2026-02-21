import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Attaches a global keydown handler mapping keys to callbacks.
 * Skips when focus is inside an input, textarea, select, or contenteditable element.
 * Binds the listener once — uses a ref to always call the latest handlers.
 */
export function useKeyboardShortcuts(handlers: Record<string, () => void>): void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const handler = handlersRef.current[e.key];
      if (handler) { e.preventDefault(); handler(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
