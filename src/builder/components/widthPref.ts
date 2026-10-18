// A panel width the user drags, remembered per browser in chrome.storage.local.
import { signal, type Signal } from '@preact/signals';

export type WidthPref = {
  width: Signal<number>;
  /** Read the saved width once (later calls do nothing). */
  load: () => void;
  /** Start a drag. direction -1 is for a handle on the LEFT edge: dragging left widens. */
  start: (e: MouseEvent, direction?: 1 | -1) => void;
};

export function widthPref(key: string, initial: number, min: number, max: number): WidthPref {
  const width = signal(initial);
  let loaded = false;
  const clamp = (w: number) => Math.min(max, Math.max(min, w));
  return {
    width,
    load() {
      if (loaded) return;
      loaded = true;
      globalThis.chrome?.storage?.local
        ?.get([key])
        .then((v) => {
          const w = Number(v?.[key]);
          if (w >= min && w <= max) width.value = w;
        })
        .catch(() => {});
    },
    start(e, direction = 1) {
      e.preventDefault();
      const x0 = e.clientX;
      const w0 = width.value;
      const onMove = (m: MouseEvent) => {
        width.value = clamp(w0 + direction * (m.clientX - x0));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        globalThis.chrome?.storage?.local?.set({ [key]: width.value })?.catch(() => {});
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
  };
}
