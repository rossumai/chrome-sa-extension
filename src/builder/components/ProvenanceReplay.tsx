import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { annotationId, domain, token, hooks, annotationContent, work } from '../store.js';
import { openHookEditor } from '../index.jsx';
import { STATUS_GLYPH, evaluateCfgCondition, replayConfig } from '../../popup/mdh-provenance.js';
import {
  provenanceInputs,
  provenanceConfigs,
  configValues,
  configOutcome,
  type Outcome,
  type ProvenanceInputs,
  type ProvenanceItem,
} from '../provenance.js';
import { pickHookConfig } from './hookJump.js';
import Stepper from './Stepper.jsx';
import s from './Builder.module.css';

const STATUS_TEXT: Record<string, string> = {
  pending: 'replaying…',
  winner: 'matched',
  empty: 'no match',
  skipped: 'skipped',
  gated: 'gated',
  error: 'failed',
};

type Status = { status: string; hint?: string };
const keyOf = (it: ProvenanceItem) => `${it.hook.id}:${it.index}`;

const OUTCOMES = [
  { kind: 'matched', label: 'Matched' },
  { kind: 'nomatch', label: 'No match' },
  { kind: 'gated', label: 'Gated' },
  { kind: 'error', label: 'Failed' },
] as const;

function outcomeText(o: Outcome): string {
  if (o.kind === 'matched') return `✓ query ${o.query + 1}${o.hint ? ` · ${o.hint}` : ''}`;
  if (o.kind === 'nomatch') return '— no match';
  if (o.kind === 'gated') return '⊘ gated';
  if (o.kind === 'error') return '! failed';
  return '… replaying';
}

// Replays one configuration (the popup's replayConfig, unchanged) and reports its statuses.
// Draws nothing, and stays mounted while its row is filtered out or folded.
function ReplayRunner({
  item,
  inputs,
  row,
  onStatuses,
}: {
  item: ProvenanceItem;
  inputs: ProvenanceInputs;
  row: number;
  onStatuses: (key: string, s: Status[]) => void;
}) {
  const { cfg } = item;
  const { values } = configValues(cfg, inputs, row);
  // Replay when the inputs change — not when a re-render hands over equal objects.
  const valuesKey = JSON.stringify(values);
  const cfgKey = JSON.stringify(cfg);
  useEffect(() => {
    const ctrl = new AbortController();
    let cur: Status[] = cfg.queries.map(() => ({ status: 'pending' }));
    onStatuses(keyOf(item), cur);
    replayConfig(
      domain.value,
      token.value,
      cfg,
      values,
      ctrl.signal,
      (i, st) => {
        cur = cur.map((p, j) => (j === i ? st : p));
        onStatuses(keyOf(item), cur);
      },
      inputs.types,
    ).catch(() => {});
    return () => ctrl.abort();
  }, [valuesKey, cfgKey]);
  return null;
}

// One configuration: a line with its outcome and query dots; details on click.
function ConfigRow({
  item,
  inputs,
  statuses,
  row,
  setRow,
  open,
  toggle,
}: {
  item: ProvenanceItem;
  inputs: ProvenanceInputs;
  statuses: Status[];
  row: number;
  setRow: (r: number) => void;
  open: boolean;
  toggle: () => void;
}) {
  const { cfg } = item;
  const { scope, values } = configValues(cfg, inputs, row);
  const outcome = configOutcome(statuses);
  const extra = cfg.additionalMappings.map((m: any) => m.target).filter(Boolean);
  return (
    <div class={s.provRow} data-provenance-config="" data-outcome={outcome.kind}>
      <button type="button" class={s.provLine} data-action="toggle-config" onClick={toggle}>
        <span class={s.caret}>{open ? '▾' : '▸'}</span>
        <span class={s.outcomeChip + ' ' + (s[`oc_${outcome.kind}`] || '')}>
          {outcomeText(outcome)}
        </span>
        <b>
          {item.index + 1} · {cfg.name || `Configuration ${item.index + 1}`}
        </b>
        <span class={s.dim + ' ' + s.provMeta}>
          {cfg.dataset} → {cfg.target}
          {extra.length ? ` +${extra.length}` : ''}
        </span>
        <span class={s.qDots}>
          {cfg.queries.map((q: any, i: number) => {
            const st = statuses[i] || { status: 'pending' };
            return (
              <span
                class={s.qDot + ' ' + (s[`q_${st.status}`] || '')}
                title={`${i + 1}. ${q.label} — ${STATUS_TEXT[st.status] ?? st.status}${st.hint ? ` (${st.hint})` : ''}`}
              >
                {i + 1}
              </span>
            );
          })}
        </span>
      </button>
      {open && (
        <div class={s.provDetails} data-provenance-details="">
          <div class={s.dim}>
            {item.hook.name} ({item.hook.id}) · {cfg.dataset} → {cfg.target}
            {extra.length ? ` (+ ${extra.join(', ')})` : ''}{' '}
            <button
              type="button"
              class="btn-link"
              title="Open this configuration in hook mode"
              onClick={() => {
                openHookEditor(item.hook.id);
                pickHookConfig(item.index);
              }}
            >
              open in hook mode
            </button>
          </div>
          {(() => {
            const cond = evaluateCfgCondition(cfg, values, inputs.types);
            return cond.hasCondition ? (
              <div class={s.mono}>
                if {cond.substituted} →{' '}
                {cond.result === null ? `error: ${cond.error}` : String(cond.result)}
              </div>
            ) : null;
          })()}
          {scope && (
            <span class={s.stepper}>
              row
              <Stepper
                at={Math.min(row, scope.rowCount - 1)}
                count={scope.rowCount}
                onStep={setRow}
              >
                {' '}
                of {scope.tableSchemaId}
              </Stepper>
            </span>
          )}
          {cfg.queries.map((q: any, i: number) => {
            const st = statuses[i] || { status: 'pending' };
            const g = STATUS_GLYPH[st.status] || STATUS_GLYPH.pending;
            return (
              <div data-query-status={st.status} title={g.title}>
                <span class={s.queryGlyph + ' ' + (s[`q_${st.status}`] || '')}>{g.glyph}</span>{' '}
                <span class={s.mono}>{q.label}</span>{' '}
                <span class={s.dim}>
                  {STATUS_TEXT[st.status] ?? st.status}
                  {st.hint ? ` — ${st.hint}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The Provenance tab: every MDH configuration replayed against the picked annotation,
// grouped by hook, with a filter by outcome.
export default function ProvenanceReplay() {
  const [statuses, setStatuses] = useState<Record<string, Status[]>>({});
  const [rows, setRows] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  if (annotationId.value == null)
    return <div class={s.dim}>Pick an annotation to replay matching.</div>;
  const items = provenanceConfigs(hooks.value);
  if (!items.length) return <div class={s.dim}>No MDH hooks on this queue.</div>;
  const inputs = provenanceInputs(annotationContent.value, work.value);
  const onStatuses = (key: string, st: Status[]) => setStatuses((prev) => ({ ...prev, [key]: st }));
  const outcomeOf = (it: ProvenanceItem) =>
    configOutcome(statuses[keyOf(it)] || it.cfg.queries.map(() => null));
  const count = (kind: string, list: ProvenanceItem[]) =>
    list.filter((it) => outcomeOf(it).kind === kind).length;
  const byHook = new Map<number, ProvenanceItem[]>();
  for (const it of items) byHook.set(it.hook.id, [...(byHook.get(it.hook.id) || []), it]);
  return (
    <div>
      {items.map((it) => (
        <ReplayRunner
          key={keyOf(it)}
          item={it}
          inputs={inputs}
          row={rows[keyOf(it)] ?? 0}
          onStatuses={onStatuses}
        />
      ))}
      <div class={s.dim}>Replayed against this annotation (read-only, first hit per query).</div>
      <div class={s.outcomeFilters}>
        <button
          type="button"
          data-outcome-filter="all"
          class={s.filterChip + (filter === 'all' ? ' ' + s.filterChipOn : '')}
          onClick={() => setFilter('all')}
        >
          All {items.length}
        </button>
        {OUTCOMES.filter((o) => count(o.kind, items) > 0).map((o) => (
          <button
            type="button"
            data-outcome-filter={o.kind}
            class={
              s.filterChip +
              ' ' +
              (s[`oc_${o.kind}`] || '') +
              (filter === o.kind ? ' ' + s.filterChipOn : '')
            }
            onClick={() => setFilter(filter === o.kind ? 'all' : o.kind)}
          >
            {o.label} {count(o.kind, items)}
          </button>
        ))}
      </div>
      {[...byHook.values()].map((list) => {
        const hook = list[0].hook;
        const shown = list.filter((it) => filter === 'all' || outcomeOf(it).kind === filter);
        return (
          <div class={s.provHook} data-provenance-hook="">
            <div class={s.provHookHead}>
              <b>
                {hook.name} ({hook.id})
              </b>
              <span class={s.dim}>
                {OUTCOMES.map((o) => {
                  const n = count(o.kind, list);
                  return n ? ` · ${o.label.toLowerCase()} ${n}` : '';
                }).join('')}
              </span>
            </div>
            {shown.map((it) => {
              const k = keyOf(it);
              return (
                <ConfigRow
                  key={k}
                  item={it}
                  inputs={inputs}
                  statuses={statuses[k] || it.cfg.queries.map(() => ({ status: 'pending' }))}
                  row={rows[k] ?? 0}
                  setRow={(r) => setRows((prev) => ({ ...prev, [k]: r }))}
                  open={open.has(k)}
                  toggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      return next;
                    })
                  }
                />
              );
            })}
            {!shown.length && <div class={s.dim}>None with this result.</div>}
          </div>
        );
      })}
    </div>
  );
}
