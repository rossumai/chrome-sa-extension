import { h, Fragment } from 'preact';
import {
  work,
  queues,
  selectedKey,
  selectedQueueId,
  engineState,
  engineFieldsByName,
  enginePlanNow,
  engineUsers,
  engineDeletes,
  engineDeletesNow,
} from '../store.js';
import { closeEnginePanel, toggleEngineDelete } from '../index.jsx';
import { flatten } from '../model.js';
import { extractedFields, engineStatus, unusedEngineFields, isRejected } from '../engine.js';
import Extraction from './Extraction.jsx';
import PanelHead from './PanelHead.jsx';
import Icon from './icons.jsx';
import s from './Builder.module.css';

const STATES = ['seeded', 'learning', 'new', 'rejected'] as const;

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
          {nowhere.map((f) => {
            const marked = engineDeletes.value.has(f.id);
            return (
              <div
                class={s.engineRow + (marked ? ' ' + s.engineDeleted : '')}
                data-engine-field={String(f.name)}
                data-marked={marked ? 'delete' : undefined}
                title={`${f.name} · ${seedText(f)}`}
              >
                <span class={s.linkName + ' ' + s.mono}>{f.name}</span>
                <span class={s.dim}>{marked ? 'deleted on Save' : seedText(f)}</span>
                <button
                  type="button"
                  class="icon-btn"
                  data-action="delete-engine-field"
                  title={
                    marked
                      ? 'Keep this engine field'
                      : 'Delete this engine field on Save (what it learned is lost)'
                  }
                  onClick={() => toggleEngineDelete(f.id)}
                >
                  {marked ? <Icon name="undo" size={12} /> : '✕'}
                </button>
              </div>
            );
          })}
          <div class={s.dim}>✕ deletes one on Save, with what it learned. Unmarked ones stay.</div>
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
    <PanelHead
      title={e ? `Engine · ${e.name} (${e.id})` : 'Engine'}
      closeAction="close-engine"
      onClose={closeEnginePanel}
    />
  );
  if (!e) {
    return (
      <aside class={s.inspector + ' ' + s.enginePanel} data-panel="engine">
        {head}
        <div class={es.error ? s.warn : s.dim}>{es.error ?? 'Loading the engine…'}</div>
      </aside>
    );
  }
  const extracted = extractedFields(work.value);
  const byName = engineFieldsByName.value;
  const counts: Record<string, number> = { seeded: 0, learning: 0, new: 0, rejected: 0 };
  for (const { node } of extracted) {
    counts[isRejected(node) ? 'rejected' : engineStatus(node, byName).state]++;
  }
  const unused = unusedEngineFields(work.value, es.fields);
  const plan = enginePlanNow.value;
  const sel = flatten(work.value).find((r) => r.key === selectedKey.value)?.node;
  const training: string[] = Array.isArray(e.training_queues) ? e.training_queues : [];
  return (
    <aside class={s.inspector + ' ' + s.enginePanel} data-panel="engine">
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
        <Extraction
          node={sel}
          label={
            <Fragment>
              Selected field · <span class={s.idInLabel}>{sel.id}</span>
            </Fragment>
          }
        />
      ) : (
        <div class={s.dim}>Pick a seed in the AI column, or click a row for its details.</div>
      )}
      <div class={s.field} data-engine-settings="">
        <span class={s.fieldLabel}>Settings (read-only)</span>
        <dl class={s.kv}>
          <dt>Use case</dt>
          <dd class={s.mono}>{e.settings?.use_case ?? <span class={s.dim}>not set</span>}</dd>
          <dt>Learning</dt>
          <dd>{e.learning_enabled ? 'on' : 'off'}</dd>
          <dt>Engine fields</dt>
          <dd>{es.fields.length}</dd>
          {e.description && <dt>Description</dt>}
          {e.description && <dd>{e.description}</dd>}
        </dl>
      </div>
      <div class={s.field + ' ' + s.engineList} data-engine-training="">
        <span class={s.fieldLabel}>Learns from ({training.length})</span>
        {training.length ? (
          training.map((url) => {
            const q = queues.value.find((x) => x.url === url);
            const id = q?.id ?? url.split('/').filter(Boolean).pop();
            return (
              <div class={s.engineRow} data-training-queue={String(id)}>
                <span class={s.linkName}>{q?.name ?? `Queue ${id}`}</span>
                <span class={s.dim}>
                  {q?.id === selectedQueueId.value ? 'this queue · ' : ''}
                  {id}
                </span>
              </div>
            );
          })
        ) : (
          <div class={s.dim}>No training queues: it learns from no confirmed documents.</div>
        )}
      </div>
      {plan && plan.create.length + plan.patch.length + engineDeletesNow.value.length > 0 && (
        <div class={s.field + ' ' + s.engineList} data-engine-save="">
          <span class={s.fieldLabel}>
            Save writes to the engine first (
            {plan.create.length + plan.patch.length + engineDeletesNow.value.length})
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
          {engineDeletesNow.value.map((f) => (
            <FieldRow name={String(f.name)} detail="delete" />
          ))}
        </div>
      )}
      {unused.length > 0 && <Unused fields={unused} />}
    </aside>
  );
}
