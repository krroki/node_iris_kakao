import { useCallback, useEffect, useState } from "react";

type WatchdogState = {
  ok: boolean;
  mtime?: string;
  lines: string[];
};

export function useWatchdog(): WatchdogState {
  const [watchdog, setWatchdog] = useState<WatchdogState>({ ok: false, lines: [] });

  const fetchWatchdog = useCallback(async () => {
    try {
      const res = await fetch(`/api/watchdog`, { cache: "no-store" });
      const data = await res.json();
      setWatchdog({
        ok: !!data.ok,
        mtime: data.mtime,
        lines: data.lines || [],
      });
    } catch {
      setWatchdog({ ok: false, lines: [] });
    }
  }, []);

  useEffect(() => {
    fetchWatchdog();
    const id = setInterval(fetchWatchdog, 15_000);
    return () => clearInterval(id);
  }, [fetchWatchdog]);

  return watchdog;
}

