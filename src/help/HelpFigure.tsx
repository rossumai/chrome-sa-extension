import { h, type ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fitZoom, calloutBox, type Rect } from './geometry.js';
import s from './Help.module.css';

export type Callout = { target: string; note: ComponentChildren };

export default function HelpFigure({
  callouts,
  children,
}: {
  callouts: Callout[];
  children: ComponentChildren;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frozenRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<(Rect | null)[]>([]);
  const [hot, setHot] = useState(-1);

  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current;
      const frozen = frozenRef.current;
      if (!stage || !frozen) return;

      // Set zoom
      const zoom = fitZoom(stage.clientWidth);
      frozen.style.zoom = String(zoom);

      // Measure callout boxes
      const stageRect = stage.getBoundingClientRect();
      const measured = callouts.map((c) => {
        const selector = c.target.startsWith('[') ? c.target : `[data-help="${c.target}"]`;
        const el = stage.querySelector(selector);
        if (!el) return null;

        const targetRect = el.getBoundingClientRect();
        const box = calloutBox(
          {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          },
          {
            left: stageRect.left,
            top: stageRect.top,
            width: stageRect.width,
            height: stageRect.height,
          },
        );
        // In jsdom, rects are 0, which is fine - we still render the pin
        return box;
      });
      setBoxes(measured);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stageRef.current!);
    return () => ro.disconnect();
  }, [callouts]);

  return (
    <figure class={s.fig} data-hot={hot >= 0 ? String(hot) : undefined}>
      <div class={s.stage} ref={stageRef}>
        <div class={s.frozen} inert ref={frozenRef}>
          {children}
        </div>
        {boxes.map((box, i) =>
          box ? (
            <div
              key={i}
              class={`${s.box} ${hot === i ? s.boxHot : ''}`}
              style={{
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }}
            >
              <span class={s.pin} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(-1)}>
                {i + 1}
              </span>
            </div>
          ) : null,
        )}
      </div>
      <ol class={s.legend}>
        {callouts.map((c, i) => (
          <li
            key={i}
            class={hot === i ? s.legendHot : ''}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => setHot(-1)}
          >
            <span class={s.num}>{i + 1}</span>
            <span>{c.note}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
