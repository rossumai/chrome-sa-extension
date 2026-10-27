import { h, Fragment } from 'preact';
import {
  work,
  queues,
  selectedKey,
  engineState,
  engineFieldsByName,
  enginePlanNow,
  engineUsers,
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

function seedText(f: any): string {
  return f.pre_trained_field_id ? `seed ${f.pre_trained_field_id}` : 'learning';
}

function changeText(body: Record<string, unknown>): string {
  const out: string[] = [];
  if ('pre_trained_field_id' in body) {
    out.push(body.pre_trained_field_id ? `seed ${body.pre_trained_field_id}` : 'no seed');
  }
  if ('type' in body) out.push(`type ${body.type}`);
  return out.join(' · ');
}

/** One engine field per line; a click selects its row in the grid, when it has one. */
function FieldRow({ name, detail }: { name: string; detail: string }) {
  const row = flatten(work.value).find((r) => String(r.node.id) === name);
  const text = (
    <Fragment>
      <span class={s.linkName + ' ' + s.mono}>{name}</span>
      <span class={s.dim}>{detail}</span>
    </Fragment>
  );
  return row ? (
    <button
      type="button"
      class={s.linkRow}
      data-engine-field={name}
      title={`${name} · ${detail}`}
      onClick={() => (selectedKey.value = row.key)}
    >
      {text}
    </button>
  ) : (
    <div class={s.engineRow} data-engine-field={name} title={`${name} · ${detail}`}>
      {text}
    </div>
  );
}

// Engine fields this schema does not use: those other queues on the engine use, and those no
// queue uses (left over from a rename or a removed field).
function Unused({ fields }: { fields: any[] }) {
  const users = engineUsers.value;
  if (!users?.byName) {
    return (
      <div class={s.field + ' ' + s.engineList} data-engine-unused="">
        <span class={s.fieldLabel}>Engine fields not in this schema ({fields.length})</span>
        {users?.error ? (
          <div class={s.warn}>Could not read the other queues on this engine: {users.error}</div>
        ) : (
          <div class={s.dim}>Checking the other queues on this engine…</div>
        )}
        {fields.map((f) => (
          <FieldRow name={String(f.name)} detail={seedText(f)} />
        ))}
      </div>
    );
  }
  const byName = users.byName;
  const elsewhere = fields.filter((f) => byName.has(String(f.name)));
  const nowhere = fields.filter((f) => !byName.has(String(f.name)));
  return (
    <Fragment>
      {elsewhere.length > 0 && (
        <div class={s.field + ' ' + s.engineList} data-engine-elsewhere="">
          <span class={s.fieldLabel}>Used by other queues ({elsewhere.length})</span>
          {elsewhere.map((f) => (
            <FieldRow name={String(f.name)} detail={byName.get(String(f.name))!.join(', ')} />
          ))}
        </div>
      )}
      {nowhere.length > 0 && (
        <div class={s.field + ' ' + s.engineList} data-engine-nowhere="">
          <span class={s.fieldLabel}>Not used by any queue ({nowhere.length})</span>
          {nowhere.map((f) => (
            <FieldRow name={String(f.name)} detail={seedText(f)} />
          ))}
          <div class={s.dim}>Save leaves them on the engine.</div>
        </div>
      )}
    </Fragment>
  );
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
      {plan && plan.create.length + plan.patch.length > 0 && (
        <div class={s.field + ' ' + s.engineList} data-engine-save="">
          <span class={s.fieldLabel}>
            Save writes to the engine first ({plan.create.length + plan.patch.length})
          </span>
          {plan.create.map((c) => (
            <FieldRow
              name={String(c.name)}
              detail={`create · ${c.pre_trained_field_id ? `seed ${c.pre_trained_field_id}` : 'learning'}`}
            />
          ))}
          {plan.patch.map((p) => (
            <FieldRow name={p.name} detail={`update · ${changeText(p.body)}`} />
          ))}
        </div>
      )}
      {unused.length > 0 && <Unused fields={unused} />}
    </aside>
  );
}
