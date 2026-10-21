import { h } from 'preact';
import { validation } from '../store.js';
import Icon from './icons.jsx';
import s from './Builder.module.css';

const ICONS = { error: 'error', warning: 'warning', info: 'info' } as const;

// After a Revalidate: how many messages and fired rules, and the messages that belong to no
// field (they cannot be shown in a Value cell).
export default function ValidationStrip() {
  const v = validation.value;
  if (!v) return null;
  let onFields = 0;
  for (const rows of v.placed.byField.values())
    for (const list of rows.values()) onFields += list.length;
  return (
    <div class={s.validationStrip} data-validation-strip="">
      <span class={s.dim}>
        Validated · {onFields} message{onFields === 1 ? '' : 's'} on fields · {v.fired.size} rule
        {v.fired.size === 1 ? '' : 's'} fired
      </span>
      {v.placed.general.map((m) => (
        <span class={s.mark + ' ' + (s[`mark_${m.type}`] || '')} title={m.content}>
          <Icon name={ICONS[m.type as keyof typeof ICONS] ?? 'info'} size={14} />
          <span class={s.stripText}>{m.content}</span>
        </span>
      ))}
    </div>
  );
}
