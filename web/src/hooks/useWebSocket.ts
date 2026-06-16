import { useEffect, useRef, useState, useCallback } from 'react';

export interface LiveEvent {
  type: string;
  timestamp: number;
  botName?: string;
  chatId?: string;
  messageId?: string;
  text?: string;
  fromBotName?: string;
  source?: string;
  meta?: Record<string, unknown>;
  handoffFrom?: string;
  handoffTo?: string;
}

interface UseWebSocketOptions {
  url: string;
  reconnectMs?: number;
}

export function useWebSocket({ url, reconnectMs = 3000 }: UseWebSocketOptions) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === 'snapshot' && Array.isArray(data.events)) {
          setEvents(data.events);
        } else {
          setEvents((prev) => {
            const next = [...prev, data];
            return next.length > 200 ? next.slice(-200) : next;
          });
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      timerRef.current = setTimeout(connect, reconnectMs);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [url, reconnectMs]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
