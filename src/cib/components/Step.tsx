// src/cib/components/Step.tsx
// One numbered step of the CIB page: a circle on the step line, then a card.
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import styles from './App.module.css';

export default function Step({
  n,
  state,
  title,
  sub,
  meta,
  footer,
  children,
}: {
  n: string | number;
  state?: 'complete' | 'current' | 'optional';
  title: ComponentChildren;
  sub?: ComponentChildren;
  meta?: string;
  footer?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <section class={`${styles.step} ${state ? styles[state] : ''}`}>
      <div class={styles.num}>{state === 'complete' ? '✓' : n}</div>
      <div class={styles.card}>
        <div class={styles.cardHead}>
          <div class={styles.grow}>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {meta && <span class={styles.meta}>{meta}</span>}
        </div>
        <div class={styles.cardBody}>{children}</div>
        {footer && <div class={styles.cardFoot}>{footer}</div>}
      </div>
    </section>
  );
}
