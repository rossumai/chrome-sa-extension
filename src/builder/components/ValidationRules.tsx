import { h } from 'preact';
import { validation, rules, values, work, revalidating } from '../store.js';
import { openRuleEditor, revalidate, revealRow } from '../index.jsx';
import { flatten } from '../model.js';
import type { PlacedMessage } from '../validation.js';
import Icon from './icons.jsx';
import s from './Builder.module.css';

const ICON = { error: 'error', warning: 'warning', info: 'info' } as const;

function Msg({ m, where }: { m: PlacedMessage; where?: string }) {
  return (
    <span class={s.msgLine}>
      <span class={s.mark + ' ' + (s[`mark_${m.type}`] || '')}>
        <Icon name={ICON[m.type as keyof typeof ICON] ?? 'info'} size={14} />
      </span>
      {where && <b class={s.mono}>{where}</b>} {m.content}
    </span>
  );
}

type Located = { m: PlacedMessage; field: string | null; row: number };

// Every message with where it sits; `row` is shown (1-based) for a table column.
function allMessages(): Located[] {
  const v = validation.value;
  if (!v) return [];
  const out: Located[] = [];
  for (const [field, rows] of v.placed.byField) {
    for (const [row, list] of rows) for (const m of list) out.push({ m, field, row });
  }
  for (const m of v.placed.general) out.push({ m, field: null, row: 0 });
  return out;
}

function whereOf(x: Located): string {
  if (!x.field) return 'Whole document:';
  const inTable = x.row > 0 || (values.value?.values.get(x.field)?.length ?? 0) > 1;
  return inTable ? `${x.field} (row ${x.row + 1}):` : `${x.field}:`;
}

// The Rules tab: each rule, fired first, with its messages; then the messages no rule made.
export default function ValidationRules() {
  const v = validation.value!;
  const msgs = allMessages();
  const keyOf = new Map(flatten(work.value).map((r) => [String(r.node.id), r.key]));
  const onFields = msgs.filter((x) => x.field).length;
  const ordered = [...rules.value].sort(
    (a, b) => Number(v.fired.has(b.id)) - Number(v.fired.has(a.id)),
  );
  const others = msgs.filter((x) => x.m.ruleId == null);
  return (
    <div>
      <div class={s.codeBar}>
        <span class={s.dim}>
          Validated · {onFields} message{onFields === 1 ? '' : 's'} on fields · {v.fired.size} rule
          {v.fired.size === 1 ? '' : 's'} fired
        </span>
        <button type="button" class="btn-link" disabled={revalidating.value} onClick={revalidate}>
          {revalidating.value ? 'Validating…' : '↻ Revalidate again'}
        </button>
      </div>
      <div class={s.groupTitle}>Rules</div>
      {ordered.map((r) => {
        const fired = v.fired.has(r.id);
        return (
          <div
            class={s.resultItem}
            data-rule-result={String(r.id)}
            data-fired={fired ? 'true' : 'false'}
          >
            <span class={fired ? s.firedDot : s.quietDot}>{fired ? '●' : '○'}</span>
            <button type="button" class="btn-link" onClick={() => openRuleEditor(r.id)}>
              {r.name} ({r.id})
            </button>
            {msgs
              .filter((x) => x.m.ruleId === r.id)
              .map((x) => (
                <div class={s.resultMsg}>
                  <Msg m={x.m} where={whereOf(x)} />
                </div>
              ))}
          </div>
        );
      })}
      {!rules.value.length && <div class={s.dim}>No rules on this queue.</div>}
      <div class={s.groupTitle}>Other messages (hooks, field checks)</div>
      {others.map((x) => (
        <button
          type="button"
          class={s.resultItem + ' ' + s.resultClick}
          data-other-message=""
          onClick={() => x.field && keyOf.has(x.field) && revealRow(keyOf.get(x.field)!)}
        >
          <Msg m={x.m} where={whereOf(x)} />
        </button>
      ))}
      {!others.length && <div class={s.dim}>None.</div>}
      <details>
        <summary class={s.dim}>Raw response</summary>
        <pre class={s.code}>{JSON.stringify(v.raw, null, 2)}</pre>
      </details>
    </div>
  );
}
