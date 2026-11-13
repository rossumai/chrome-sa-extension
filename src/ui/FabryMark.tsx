// src/ui/FabryMark.tsx
// The shared "Mr. Fabry" identity mark: a filled four-point star. One source of
// truth for every in-app Fabry surface (chat, audit, inspector, MDH input, the
// Console rail). Fill is `currentColor` (via .fabry-mark in console.css), so the
// mark inherits each surface's color — including the rail's white-when-active.
// `animated` (default) adds a slow blue→indigo→violet color cycle; the rail passes
// animated={false} for a static mark. Colors + reduced-motion handling live in CSS.
import { h } from 'preact';
import styles from './FabryMark.module.css';
import { STAR_PATH } from './fabryStar.js';

export default function FabryMark({
  size = '1em',
  animated = true,
  class: className,
  title,
}: {
  size?: string | number;
  animated?: boolean;
  class?: string;
  title?: string;
}) {
  const cls =
    styles.mark + (animated ? ' ' + styles.animated : '') + (className ? ' ' + className : '');
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {title ? <title>{title}</title> : null}
      <path d={STAR_PATH} />
    </svg>
  );
}
