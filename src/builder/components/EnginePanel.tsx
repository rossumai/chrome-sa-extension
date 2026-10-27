import { h } from 'preact';
import {
  work,
  queues,
  selectedKey,
  engineState,
  engineFieldsByName,
  enginePlanNow,
} from '../store.js';
import { closeEnginePanel } from '../index.jsx';
import { flatten } from '../model.js';
import { extractedFields, engineStatus, unusedEngineFields } from '../engine.js';
import Extraction from './Extraction.jsx';
import WideButton from './WideButton.jsx';
import s from './Builder.module.css';

const STATES = ['seeded', 'learning', 'new', 'rejected'] as const;

// Use cases measured to extract no line items: a table column on them stays empty.
const HEADER_ONLY = ['generic_ap'];

function queueName(url: string): string {
  const q = queues.value.find((x) => x.url === url);
  return q ? `${q.name} (${q.id})` : url.split('/').filter(Boolean).pop() || url;
}

// The custom engine of the open queue. The grid shows only extracted fields, each with its
// seed picker; the panel shows the selected field, the engine's settings (read-only: the
// engine may serve other queues) and what Save writes to it.
export default function EnginePanel() {
  const es = engineState.value!;
  const e = es.engine;
  const head = (
    <div class={s.ruleHead}>
      <h4 class={s.inspTitle}>{e ? `Engine · ${e.name} (${e.id})` : 'Engine'}</h4>
      <WideButton />
      <button
        type="button"
        class={s.iconBtn}
        data-action="close-engine"
        title="Close (Esc)"
        onClick={closeEnginePanel}
      >
        ✕
      </button>
    </div>
  );
  if (!e) {
    return (
      <aside class={s.inspector} data-panel="engine">
        {head}
        <div class={es.error ? s.warn : s.dim}>{es.error ?? 'Loading the engine…'}</div>
      </aside>
    );
  }
  const extracted = extractedFields(work.value);
  const byName = engineFieldsByName.value;
  const counts: Record<string, number> = { seeded: 0, learning: 0, new: 0, rejected: 0 };
  for (const { node } of extracted) {
    const rejected = (node.rir_field_names?.length ?? 0) > 0 || node.disable_prediction === true;
    counts[rejected ? 'rejected' : engineStatus(node, byName).state]++;
  }
  const tables = extracted.filter((x) => x.tabular).length;
  const useCase = e.settings?.use_case ?? 'generic_ap';
  const unused = unusedEngineFields(work.value, es.fields);
  const plan = enginePlanNow.value;
  const sel = flatten(work.value).find((r) => r.key === selectedKey.value)?.node;
  const training: string[] = Array.isArray(e.training_queues) ? e.training_queues : [];
  return (
    <aside class={s.inspector} data-panel="engine">
      {head}
      <div class={s.dim}>
        {extracted.length} extracted fields:{' '}
        {STATES.filter((st) => counts[st]).map((st) => (
          <span class={s.aiChip + ' ' + s['ai_' + st]} data-engine-count={st}>
            {counts[st]} {st === 'rejected' ? 'to fix' : st}
          </span>
        ))}
      </div>
      {sel && sel.category === 'datapoint' ? (
        <Extraction node={sel}>{null}</Extraction>
      ) : (
        <div class={s.dim}>Pick a seed in the AI column, or click a row for its details.</div>
      )}
      {plan && plan.create.length + plan.patch.length > 0 && (
        <div class={s.field} data-engine-save="">
          <span class={s.fieldLabel}>Save writes to the engine first</span>
          {plan.create.length > 0 && (
            <div>
              create: <span class={s.mono}>{plan.create.map((c) => c.name).join(', ')}</span>
            </div>
          )}
          {plan.patch.length > 0 && (
            <div>
              update: <span class={s.mono}>{plan.patch.map((p) => p.name).join(', ')}</span>
            </div>
          )}
        </div>
      )}
      <div class={s.field} data-engine-settings="">
        <span class={s.fieldLabel}>Settings (read-only)</span>
        <div>
          Use case <span class={s.mono}>{useCase}</span> · learning{' '}
          {e.learning_enabled ? 'on' : 'off'} · {es.fields.length} engine fields
        </div>
        {tables > 0 && HEADER_ONLY.includes(useCase) && (
          <div class={s.warn} data-engine-warning="use-case">
            Use case {useCase} extracts no line items: its {tables} table{' '}
            {tables === 1 ? 'column stays' : 'columns stay'} empty.
          </div>
        )}
        <div>
          Learns from:{' '}
          {training.length ? training.map(queueName).join(', ') : <span class={s.dim}>none</span>}
        </div>
        {e.description && <div class={s.dim}>{e.description}</div>}
      </div>
      {unused.length > 0 && (
        <div class={s.field} data-engine-unused="">
          <span class={s.fieldLabel}>Not in this schema ({unused.length})</span>
          <div class={s.mono}>{unused.map((f) => f.name).join(', ')}</div>
          <div class={s.dim}>Other queues on this engine may use them. Save leaves them.</div>
        </div>
      )}
    </aside>
  );
}
