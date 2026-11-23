import { useEffect, useState } from 'preact/hooks';

// The current time, re-read every `everyMs` while `active` (and once when it
// turns active), so elapsed-time displays and time thresholds re-render.
export function useNow(active: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
