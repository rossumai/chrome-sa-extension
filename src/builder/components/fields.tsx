import { h, type ComponentChildren } from 'preact';
import s from './Builder.module.css';

/**
 * A panel field: its label over its control. A <label>, so a click on the text focuses the
 * one control; `block` makes it a <div>, for a group of controls or read-only content.
 * `extra` adds a class; data-* attributes land on the element.
 */
export function Field({
  label,
  block = false,
  extra,
  children,
  ...data
}: {
  label: ComponentChildren;
  block?: boolean;
  extra?: string;
  children?: ComponentChildren;
  [attr: `data-${string}`]: string | undefined;
}) {
  const Tag = block ? 'div' : 'label';
  return (
    <Tag class={s.field + (extra ? ' ' + extra : '')} {...data}>
      <span class={s.fieldLabel}>{label}</span>
      {children}
    </Tag>
  );
}

/** A list edited as text: split at commas (or line breaks), trimmed, blanks dropped. */
export function splitList(text: string, lines = false): string[] {
  return text
    .split(lines ? '\n' : ',')
    .map((x) => x.trim())
    .filter(Boolean);
}
