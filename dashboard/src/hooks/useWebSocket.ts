import { useEffect, useRef, useCallback } from "react";
import type { WsEvent } from "../types";

const WS_URL = `ws://${location.host}`;
const INITIAL_DELAY = 500;
const MAX_DELAY = 8000;

export function useWebSocket(onEvent: (event: WsEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(INITIAL_DELAY);
  const onEventRef = useRef(onEvent);
  const destroyedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (destroyedRef.current) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as WsEvent;
        onEventRef.current(event);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onopen = () => {
      reconnectDelay.current = INITIAL_DELAY;
    };

    ws.onclose = () => {
      if (destroyedRef.current) return;
      timerRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_DELAY);
        connect();
      }, reconnectDelay.current);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      destroyedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
