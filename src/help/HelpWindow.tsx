import { h } from 'preact';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import {
  clampRect,
  defaultRect,
  moveRect,
  resizeRect,
  type Edge,
  type WinRect,
} from './geometry.js';
import { helpRect, saveHelpRect } from './rect.js';
import HelpPanel, { type HelpSection } from './HelpPanel.jsx';
import s from './Help.module.css';

const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const EDGE_CLASS: Record<Edge, string> = {
  n: s.edgeN,
  s: s.edgeS,
  e: s.edgeE,
  w: s.edgeW,
  ne: s.edgeNe,
  nw: s.edgeNw,
  se: s.edgeSe,
  sw: s.edgeSw,
};

type Drag = Edge | 'move';

const dragCursor = (d: Drag) =>
  d === 'move'
    ? 'grabbing'
    : d === 'n' || d === 's'
      ? 'ns-resize'
      : d === 'e' || d === 'w'
        ? 'ew-resize'
        : d === 'ne' || d === 'sw'
          ? 'nesw-resize'
          : 'nwse-resize';

// A movable, resizable, non-modal window around HelpPanel. Its rect lives in viewport pixels and
// is re-clamped on every render, so a smaller browser window pulls it back inside.
export default function HelpWindow({
  title,
  placeholder,
  sections,
  onClose,
}: {
  title: string;
  placeholder: string;
  sections: HelpSection[];
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  // the rect while a drag is in flight; null when idle, so the stored rect shows
  const [live, setLive] = useState<{ drag: Drag; rect: WinRect } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const stopDrag = useRef<(() => void) | null>(null);

  const vw = globalThis.innerWidth;
  const vh = globalThis.innerHeight;
  const stored = helpRect.value;
  const r = live?.rect ?? (stored ? clampRect(stored, vw, vh) : defaultRect(vw, vh));

  useEffect(() => {
    globalThis.addEventListener('resize', rerender);
    return () => globalThis.removeEventListener('resize', rerender);
  }, []);

  // Escape closes only a visible window (CIB stays mounted while hidden), and only when no
  // other handler used the key first: Escape in a combobox closes its suggestions instead
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!frameRef.current?.getClientRects().length) return;
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const startDrag = (drag: Drag, e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopDrag.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const r0 = r;
    let last = r0;
    setLive({ drag, rect: r0 });

    const handleMove = (m: MouseEvent) => {
      const dx = m.clientX - x0;
      const dy = m.clientY - y0;
      const w = globalThis.innerWidth;
      const hh = globalThis.innerHeight;
      last = drag === 'move' ? moveRect(r0, dx, dy, w, hh) : resizeRect(r0, drag, dx, dy, w, hh);
      setLive({ drag, rect: last });
    };
    const handleUp = () => {
      stopDrag.current?.();
      if (last !== r0) saveHelpRect(last);
      setLive(null);
    };

    globalThis.addEventListener('mousemove', handleMove);
    globalThis.addEventListener('mouseup', handleUp);
    stopDrag.current = () => {
      globalThis.removeEventListener('mousemove', handleMove);
      globalThis.removeEventListener('mouseup', handleUp);
      stopDrag.current = null;
    };
  };

  // layout-effect cleanup runs synchronously on unmount, so no listener outlives the window
  useLayoutEffect(() => {
    return () => stopDrag.current?.();
  }, []);

  const startMove = (e: MouseEvent) => {
    // the header's buttons stay buttons
    if ((e.target as HTMLElement).closest('button')) return;
    startDrag('move', e);
  };

  const drag = live?.drag;
  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-label={title}
      class={`${s.win} ${drag ? s.winActive : ''}`}
      style={{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}
    >
      <HelpPanel
        title={title}
        placeholder={placeholder}
        sections={sections}
        onClose={onClose}
        titleBarProps={{
          class: drag === 'move' ? s.titleBarMoving : s.titleBar,
          onMouseDown: startMove,
        }}
      />
      {EDGES.map((edge) => (
        <div
          key={edge}
          class={`${s.edge} ${EDGE_CLASS[edge]}`}
          data-edge={edge}
          onMouseDown={(e) => startDrag(edge, e)}
        />
      ))}
      <div class={s.sizeLabel} data-help-size>
        {Math.round(r.w)} × {Math.round(r.h)}
      </div>
      {drag && <div class={s.shield} data-help-shield style={{ cursor: dragCursor(drag) }} />}
    </div>
  );
}
