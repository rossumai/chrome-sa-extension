import { signal } from '@preact/signals';
import { clampRect, type WinRect } from './geometry.js';

export const HELP_RECT_KEY = 'helpWindowRect';

// null until a stored rect has loaded (or when none is stored): the window uses defaultRect
export const helpRect = signal<WinRect | null>(null);

let rectLoaded = false;

export function loadHelpRect(): Promise<void> {
  if (rectLoaded) return Promise.resolve();
  rectLoaded = true;
  return (
    globalThis.chrome?.storage?.local
      ?.get([HELP_RECT_KEY])
      .then((v) => {
        const stored = v?.[HELP_RECT_KEY];
        // a move made before the read answered wins over the stored rect
        if (stored !== undefined && helpRect.value === null)
          helpRect.value = clampRect(stored, globalThis.innerWidth, globalThis.innerHeight);
      })
      .catch(() => {}) || Promise.resolve()
  );
}

/** Called when a move or resize ends, never on every mouse move. */
export function saveHelpRect(r: WinRect): void {
  helpRect.value = r;
  globalThis.chrome?.storage?.local?.set({ [HELP_RECT_KEY]: r })?.catch(() => {});
}
