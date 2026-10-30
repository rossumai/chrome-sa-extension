import { h } from 'preact';
import {
  work,
  values,
  lineRow,
  validation,
  schemaLocked,
  hookFieldConfigs,
  engineState,
  engineFieldsByName,
  engineMode,
  ruleEval,
} from '../store.js';
import { apply, editAttr, openEnginePanel } from '../index.jsx';
import { setAttr, type Node } from '../model.js';
import Stepper from './Stepper.jsx';
import Icon, { type IconName } from './icons.jsx';
import type { ActionMark } from '../rules.js';
import { isExtracted, engineStatus, isRejected } from '../engine.js';
import { SeedPicker } from './Extraction.jsx';
import { evalText } from '../ruleEval.js';
import s from './Builder.module.css';

// The grid's cells, one component per column that needs more than text.

const TYPES = ['string', 'number', 'date', 'enum', 'button'];
const SOURCES = ['captured', 'data', 'manual', 'formula', 'reasoning'];

// The three flags as icon toggles in Rossum's own style: green when on, grey and struck
// through when off. Each: its icon, whether it is on, what a toggle writes, and whether a
// table has it too (only Visible).
type Flag = 'visible' | 'export' | 'required';
const FLAGS: {
  flag: Flag;
  icon: IconName;
  title: string;
  on: (n: Node) => boolean;
  path: string[];
  value: (on: boolean) => boolean;
  table: boolean;
}[] = [
  {
    flag: 'visible',
    icon: 'eye',
    title: 'Visible',
    on: (n) => !n.hidden,
    path: ['hidden'],
    value: (v) => !v,
    table: true,
  },
  {
    flag: 'export',
    icon: 'export',
    title: 'Export',
    on: (n) => n.can_export !== false,
    path: ['can_export'],
    value: (v) => v,
    table: false,
  },
  {
    flag: 'required',
    icon: 'asterisk',
    title: 'Required',
    on: (n) => !!n.constraints?.required,
    path: ['constraints', 'required'],
    value: (v) => v,
    table: false,
  },
];

/** The row's flag buttons, one slot each (empty where the row has no such flag). */
export function Flags({ node }: { node: Node }) {
  const dp = node.category === 'datapoint';
  return (
    <span class={s.flags}>
      {FLAGS.map((f) => {
        const on = f.on(node);
        return (
          <span>
            {(dp || (f.table && node.category === 'multivalue')) && (
              <button
                type="button"
                class={s.flag + (on ? ' ' + s.flagOn : '')}
                data-col={f.flag}
                aria-pressed={on ? 'true' : 'false'}
                title={`${f.title}: ${on ? 'on' : 'off'}`}
                disabled={schemaLocked.value}
                onClick={(e) => {
                  e.stopPropagation();
                  editAttr(node.__key, f.path, f.value(!on));
                }}
              >
                <Icon name={f.icon} slashed={!on} />
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function SourceCell({ node }: { node: Node }) {
  const src = node.ui_configuration?.type;
  if (src !== undefined && !SOURCES.includes(src))
    return <span class={s.readonly}>{String(src)}</span>;
  return (
    <select
      class={s.select}
      disabled={schemaLocked.value}
      value={src ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        editAttr(
          node.__key,
          ['ui_configuration', 'type'],
          (e.currentTarget as HTMLSelectElement).value,
        )
      }
    >
      {src === undefined && <option value="">(not set)</option>}
      {SOURCES.map((v) => (
        <option value={v}>{v}</option>
      ))}
    </select>
  );
}

export function TypeCell({ node }: { node: Node }) {
  return (
    <select
      class={s.select}
      disabled={schemaLocked.value}
      value={node.type ?? 'string'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        let next = setAttr(work.value, node.__key, ['type'], v);
        if (v === 'enum' && !Array.isArray(node.options))
          next = setAttr(next, node.__key, ['options'], []);
        apply(next);
      }}
    >
      {TYPES.map((v) => (
        <option value={v}>{v}</option>
      ))}
    </select>
  );
}

// The picked annotation's value for this row. A table column shows the row the table's
// stepper points at; the table row itself shows its row count and the stepper.
export function ValueCell({ node, tableId }: { node: Node; tableId: string | null }) {
  const v = values.value!;
  if (node.category === 'multivalue') {
    const n = v.rows.get(node.id) ?? 0;
    return (
      <span class={s.stepper}>
        {n} rows
        {n > 1 && (
          <span>
            <Stepper
              at={Math.min(lineRow.value[node.id] ?? 0, n - 1)}
              count={n}
              action="row"
              onStep={(i) => (lineRow.value = { ...lineRow.value, [node.id]: i })}
            />
          </span>
        )}
      </span>
    );
  }
  if (node.category !== 'datapoint') return null;
  const list = v.values.get(node.id);
  const val = list?.[tableId ? (lineRow.value[tableId] ?? 0) : 0];
  const row = tableId ? (lineRow.value[tableId] ?? 0) : 0;
  const msgs = (validation.value?.placed.byField.get(node.id)?.get(row) || []).map((m) => ({
    kind: m.type,
    text: m.content,
    event: 'validation',
  }));
  return (
    <span>
      <MarkIcons marks={msgs} />
      {val === undefined ? <span class={s.dim}>—</span> : <span title={val}>{val}</span>}
    </span>
  );
}

// The open rule's condition on the picked annotation, at the top of the whole document's
// Value cell: the API evaluates the condition once per document (or table line), not per field.
export function DocEval() {
  const ev = ruleEval.value;
  if (!ev) return null;
  let body;
  if (ev.busy) body = <span class={s.dim}>…</span>;
  else if (ev.error || ev.errors.length) {
    body = (
      <span class={s.warn} data-eval="error" title={ev.error ?? ev.errors.join('\n')}>
        error
      </span>
    );
  } else if (ev.values.length) {
    const fires = ev.values.some(Boolean);
    body = (
      <span
        class={fires ? s.evalTrue : s.dim}
        data-eval={String(fires)}
        title={fires ? 'The condition is True: the rule fires' : 'The condition is False'}
      >
        {evalText(ev.values)}
      </span>
    );
  } else return null;
  return (
    <div data-rule-eval="">
      <span class={s.dim}>Rule eval </span>
      {body}
    </div>
  );
}

const MARK_ICONS: Record<string, { icon: IconName; label: string }> = {
  error: { icon: 'error', label: 'Error message' },
  warning: { icon: 'warning', label: 'Warning message' },
  info: { icon: 'info', label: 'Info message' },
  show_hide: { icon: 'eye', label: 'Show/hide' },
  blocker: { icon: 'ban', label: 'Automation blocker' },
  send_email: { icon: 'mail', label: 'Send email' },
};

// One icon per action (Rossum's icon style, colored by kind); text and event on hover.
export function MarkIcons({ marks }: { marks: ActionMark[] }) {
  if (!marks.length) return null;
  return (
    <span class={s.marks}>
      {marks.map((m) => {
        const k = MARK_ICONS[m.kind];
        return (
          <span
            class={s.mark + ' ' + (s[`mark_${m.kind}`] || '')}
            data-mark={m.kind}
            title={`${k?.label ?? m.kind}${m.text && m.text !== m.event ? `: ${m.text}` : ''} (${m.event})`}
          >
            <Icon name={k?.icon ?? 'zap'} size={14} />
          </span>
        );
      })}
    </span>
  );
}

// In hook mode: which configuration matches ON this field (in N) or fills it (out N).
export function HookBadges({ fieldId }: { fieldId: string }) {
  const list = hookFieldConfigs.value?.get(fieldId);
  if (!list) return null;
  const marks = list.flatMap((c) =>
    (c.role === 'both' ? ['in', 'out'] : [c.role]).map((role) => ({ role, c })),
  );
  return (
    <span class={s.marks}>
      {marks.map(({ role, c }) => (
        <span
          class={s.ruleBadge + ' ' + (role === 'out' ? s.badgeOut : '')}
          data-mark={role}
          title={`${role === 'in' ? 'Matched on' : 'Filled'} in configuration ${c.index + 1}: ${c.name}`}
        >
          {role} {c.index + 1}
        </span>
      ))}
    </span>
  );
}

// What the engine extracts into this field. Generic engine: its AI fields (rir_field_names).
// Custom engine: the engine field's state (see engine.ts), red when the API would reject it;
// a click opens the engine panel, where the cell becomes the seed picker.
export function AiCell({ node }: { node: Node }) {
  const es = engineState.value;
  if (!es || !isExtracted(node)) return null;
  if (es.kind !== 'custom') {
    const names: string[] = Array.isArray(node.rir_field_names) ? node.rir_field_names : [];
    return names.length ? (
      <span class={s.mono} title={names.join(', ')}>
        {names.join(', ')}
      </span>
    ) : (
      <span class={s.dim}>—</span>
    );
  }
  if (!es.engine) return null;
  const rejected = isRejected(node);
  const st = engineStatus(node, engineFieldsByName.value);
  const state = rejected ? 'rejected' : st.state;
  if (engineMode.value && !rejected) {
    return (
      <span class={s.aiPick} data-ai={state} title={`${state}${st.seed ? ` · ${st.seed}` : ''}`}>
        <SeedPicker node={node} />
      </span>
    );
  }
  return (
    <button
      type="button"
      class={s.aiChip + ' ' + s.aiBtn + ' ' + s['ai_' + state]}
      data-ai={state}
      data-action="open-engine"
      title={
        rejected
          ? 'The API rejects this on a custom engine: click to fix it'
          : `${st.seed ? `Seeded from catalog field ${st.seed}` : st.state === 'new' ? 'No engine field yet' : 'Learning: no catalog seed'} · click to edit the engine`
      }
      onClick={(e) => {
        e.stopPropagation();
        openEnginePanel(node.__key);
      }}
    >
      {rejected ? 'fix' : st.state}
    </button>
  );
}
