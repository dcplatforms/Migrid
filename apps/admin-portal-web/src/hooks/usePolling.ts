import { useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "live" | "offline";

export interface PollingState<T> {
  data: T | null;
  status: ConnectionState;
  lastUpdated: Date | null;
}

/**
 * Generic polling hook: runs `fetcher` on an interval and reports a connection
 * state so pages can show whether they are rendering live backend data or have
 * fallen back. Keeps the last successful `data` while offline (stale-while-down).
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  pollMs = 5000
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const failures = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const result = await fetcherRef.current(controller.signal);
        if (!active) return;
        failures.current = 0;
        setData(result);
        setStatus("live");
        setLastUpdated(new Date());
      } catch {
        if (!active || controller.signal.aborted) return;
        failures.current += 1;
        if (failures.current >= 2) setStatus("offline");
      }
    };

    load();
    const id = setInterval(load, pollMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [pollMs]);

  return { data, status, lastUpdated };
}
