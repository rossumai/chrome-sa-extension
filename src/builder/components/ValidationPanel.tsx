import { h, render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  validation,
  validationPanel,
  rules,
  values,
  work,
  annotationId,
  selectedQueueId,
  domain,
  token,
  revalidating,
} from '../store.js';
import { openRuleEditor, closeValidationPanel, revalidate, revealRow } from '../index.jsx';
import { flatten } from '../model.js';
import type { PlacedMessage } from '../validation.js';
import { scopeToShadow } from '../scopeCss.js';
import MdhProvenancePanel from '../../popup/components/MdhProvenancePanel.jsx';
import Icon from './icons.jsx';
import { rightPanel } from './panels.js';
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

function RulesTab() {
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
        <button type="button" class={s.linkBtn} disabled={revalidating.value} onClick={revalidate}>
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
            <button type="button" class={s.linkBtn} onClick={() => openRuleEditor(r.id)}>
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

// The popup's MDH provenance card, in a shadow root with its own copy of popup.css: neither
// stylesheet can reach the other. Builder hands it the annotation instead of a browser tab.
function ProvenanceTab() {
  const host = useRef<HTMLDivElement>(null);
  const id = annotationId.value;
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const mount = document.createElement('div');
    root.appendChild(mount);
    let cancelled = false;
    const url = globalThis.chrome?.runtime?.getURL?.('popup/popup.css');
    if (url) {
      fetch(url)
        .then((r) => r.text())
        .then((css) => {
          if (cancelled) return;
          const style = document.createElement('style');
          style.textContent = scopeToShadow(css);
          root.prepend(style);
        })
        .catch(() => {});
    }
    render(
      <MdhProvenancePanel
        context={{
          token: token.value,
          domain: domain.value,
          annotationId: id != null ? String(id) : null,
          queueId: selectedQueueId.value != null ? String(selectedQueueId.value) : null,
        }}
      />,
      mount,
    );
    return () => {
      cancelled = true;
      render(null, mount);
    };
  }, [id, validation.value]);
  return <div data-provenance-host="" ref={host} class={s.provenanceHost} />;
}

export default function ValidationPanel() {
  useEffect(rightPanel.load, []);
  const tab = validationPanel.value!;
  return (
    <aside
      class={s.inspector}
      style={{ width: `${rightPanel.width.value}px` }}
      data-panel="validation"
    >
      <div
        class={s.inspectorResizer}
        data-resize="inspector"
        onMouseDown={(e) => rightPanel.start(e as MouseEvent, -1)}
      />
      <div class={s.ruleHead}>
        <h4 class={s.inspTitle}>Validation · annotation ({annotationId.value})</h4>
        <button type="button" class={s.iconBtn} title="Close (Esc)" onClick={closeValidationPanel}>
          ✕
        </button>
      </div>
      <div class={s.tabs}>
        {(['rules', 'provenance'] as const).map((t) => (
          <button
            type="button"
            data-tab={t}
            class={s.tab + (tab === t ? ' ' + s.tabOn : '')}
            onClick={() => (validationPanel.value = t)}
          >
            {t === 'rules' ? 'Rules' : 'Provenance'}
          </button>
        ))}
      </div>
      {tab === 'rules' ? (
        validation.value ? (
          <RulesTab />
        ) : (
          <div class={s.dim}>Revalidate the annotation to see results.</div>
        )
      ) : (
        <ProvenanceTab />
      )}
    </aside>
  );
}
