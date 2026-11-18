import { useEffect, useRef, useState } from 'preact/hooks';

/** 'copied' and 'failed' show for this long, then the button reads its label again. */
export const COPY_FEEDBACK_MS = 1600;

/**
 * Copies to the clipboard and says whether it worked. A button that copies silently
 * reads as broken, and one that says "Copied" when the browser refused is worse.
 */
export function useCopy(): ['idle' | 'copied' | 'failed', (text: string) => Promise<void>] {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async (text: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      /* no clipboard, or the browser refused */
    }
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
  };
  return [state, copy];
}
