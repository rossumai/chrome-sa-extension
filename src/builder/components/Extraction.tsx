import { h, Fragment, type ComponentChildren } from 'preact';
import { work, base, engineState, engineCatalog, engineFieldsByName } from '../store.js';
import { apply } from '../index.jsx';
import { setAttr, type Node } from '../model.js';
import { isExtracted, engineStatus, isTabular, renamedFrom } from '../engine.js';
import SearchPicker from './SearchPicker.jsx';
import s from './Builder.module.css';

const STATE_TEXT = {
  seeded: 'Has a catalog seed.',
  learning: "No catalog seed: it learns from confirmed documents in the engine's training queues.",
  new: 'No engine field yet: Save creates it before it saves the schema.',
};

function edit(node: Node, path: string[], value: unknown) {
  apply(setAttr(work.value, node.__key, path, value));
}

function catalogOptions(node: Node) {
  const tabular = isTabular(work.value, node.__key);
  return engineCatalog.value
    .filter((c) => !!c.tabular === tabular)
    .map((c) => ({ value: String(c.name), label: `${c.name} · ${c.label ?? ''}` }));
}

const NO_SEED = 'none — learns from documents';

/** A datapoint's catalog seed on a custom engine; in the field panel and the engine mode grid. */
export function SeedPicker({ node }: { node: Node }) {
  const st = engineStatus(node, engineFieldsByName.value);
  const pick = (v: string) => {
    const seed = v || null;
    // Back to what the engine field already has: drop the staged edit, so the row is clean.
    if (st.field && (st.field.pre_trained_field_id ?? null) === seed) {
      edit(node, ['__engine'], undefined);
    } else edit(node, ['__engine', 'pre_trained_field_id'], seed);
  };
  return (
    <SearchPicker
      picker="engine-seed"
      value={st.seed ?? ''}
      placeholder={NO_SEED}
      options={[{ value: '', label: NO_SEED }, ...catalogOptions(node)]}
      onPick={pick}
    />
  );
}

// The field panel's Extraction section. Generic engine: the AI fields (children, the
// rir_field_names box) plus a catalog picker. Custom engine: the engine field and its seed.
export default function Extraction({
  node,
  children,
  label,
}: {
  node: Node;
  children: ComponentChildren;
  /** The section's heading; the field panel names the engine, the engine panel the field. */
  label?: ComponentChildren;
}) {
  const es = engineState.value;
  if (es?.kind !== 'custom') {
    const names: string[] = Array.isArray(node.rir_field_names) ? node.rir_field_names : [];
    return (
      <Fragment>
        {children}
        {es?.kind === 'generic' && engineCatalog.value.length > 0 && (
          <SearchPicker
            picker="ai-catalog"
            value=""
            placeholder="+ AI field from the catalog"
            options={catalogOptions(node).filter((o) => !names.includes(o.value))}
            onPick={(v) => edit(node, ['rir_field_names'], [...names, v])}
          />
        )}
      </Fragment>
    );
  }
  if (!isExtracted(node)) {
    return (
      <div class={s.field} data-extraction="none">
        <span class={s.fieldLabel}>Extraction</span>
        <div class={s.dim}>Not extracted: its source is {node.ui_configuration?.type}.</div>
      </div>
    );
  }
  if (!es.engine) {
    return (
      <div class={s.field}>
        <span class={s.fieldLabel}>Extraction</span>
        <div class={es.error ? s.warn : s.dim}>{es.error ?? 'Loading the engine…'}</div>
      </div>
    );
  }
  const byName = engineFieldsByName.value;
  const st = engineStatus(node, byName);
  const field = st.field;
  const oldName = renamedFrom(base.value, node, byName);
  const rir: string[] = Array.isArray(node.rir_field_names) ? node.rir_field_names : [];
  return (
    <div class={s.field} data-extraction={st.state}>
      <span class={s.fieldLabel}>
        {label ?? `Extraction · ${es.engine.name} (${es.engine.id})`}
      </span>
      <div>
        <span class={s.aiChip + ' ' + s['ai_' + st.state]}>{st.state}</span>{' '}
        <span class={s.dim}>{STATE_TEXT[st.state]}</span>
      </div>
      {field && (
        <div class={s.dim}>
          Engine field ({field.id}) · {field.type}
          {field.subtype ? ` · ${field.subtype}` : ''}
        </div>
      )}
      <span class={s.fieldLabel}>Catalog seed</span>
      <SeedPicker node={node} />
      {oldName && (
        <div class={s.warn}>
          Renamed from {oldName}: Save creates a new engine field. What {oldName} learned stays with
          the old one.
        </div>
      )}
      {rir.length > 0 && (
        <div class={s.warn}>
          AI fields must be empty on a custom engine ({rir.join(', ')}).{' '}
          <button
            type="button"
            class="btn-link"
            data-action="clear-rir"
            onClick={() => edit(node, ['rir_field_names'], [])}
          >
            Clear
          </button>
        </div>
      )}
      {node.disable_prediction === true && (
        <div class={s.warn}>
          Disable prediction must be off on a custom engine.{' '}
          <button
            type="button"
            class="btn-link"
            data-action="enable-prediction"
            onClick={() => edit(node, ['disable_prediction'], undefined)}
          >
            Turn off
          </button>
        </div>
      )}
    </div>
  );
}
