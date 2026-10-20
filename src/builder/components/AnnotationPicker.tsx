import { h, Fragment } from 'preact';
import {
  annotations,
  annotationId,
  annotationError,
  values,
  fieldFilter,
  work,
  rules,
  ruleRefs,
  selectedQueueId,
  ruleEditor,
} from '../store.js';
import { flatten } from '../model.js';
import { countMatches } from '../fieldFilter.js';
import { pickAnnotation, clearAnnotation, openRuleEditor, closeRuleEditor } from '../index.jsx';
import s from './Builder.module.css';

// The bar above the grid: the filters — text (id or label) and a rule (only its fields) —
// then an annotation (one of the queue's newest, or any pasted ID or URL) whose values show
// next to each field.
export default function AnnotationPicker() {
  const id = annotationId.value;
  const listed = annotations.value.some((a) => a.id === id);
  const editing = ruleEditor.value;
  const matchCount = countMatches(work.value, fieldFilter.value);
  // Fields the picked rule names that this schema does not have: usually a broken rule.
  const refs = ruleRefs.value;
  const ids = new Set(flatten(work.value).map((r) => r.node.id));
  const missing = refs
    ? [...new Set([...refs.condition, ...refs.actions])].filter((x) => !ids.has(x))
    : [];
  return (
    <div class={s.pickBar}>
      <input
        class={s.input + ' ' + s.fieldFilter}
        data-filter="fields"
        placeholder="Find field by ID or label"
        value={fieldFilter.value}
        onInput={(e) => (fieldFilter.value = (e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') fieldFilter.value = '';
        }}
      />
      {fieldFilter.value.trim() && (
        <span class={s.dim}>
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </span>
      )}
      {selectedQueueId.value != null && (
        <Fragment>
          <span class={s.dim}>Rule</span>
          <select
            class={s.select}
            data-picker="rule"
            value={editing ? (editing.ruleId != null ? String(editing.ruleId) : 'new') : ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v && v !== 'new') openRuleEditor(Number(v));
              else if (!v) closeRuleEditor();
            }}
          >
            <option value="">{rules.value.length ? 'no rule' : 'no rules on this queue'}</option>
            {editing && editing.ruleId == null && <option value="new">new rule (unsaved)</option>}
            {rules.value.map((r) => (
              <option value={String(r.id)}>
                {r.name} ({r.id}){r.enabled === false ? ' · disabled' : ''}
              </option>
            ))}
          </select>
          {editing && (
            <button
              type="button"
              class={s.iconBtn}
              data-action="clear-rule"
              title="Stop filtering by this rule"
              onClick={closeRuleEditor}
            >
              ✕
            </button>
          )}
          {missing.length > 0 && (
            <span
              class={s.warn}
              title="The rule names these fields, but this schema has none of them"
            >
              not in schema: {missing.join(', ')}
            </span>
          )}
        </Fragment>
      )}
      <span class={s.barGap} />
      <span class={s.dim}>Values from</span>
      <select
        class={s.select}
        value={id != null && listed ? String(id) : ''}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v) pickAnnotation(v);
          else clearAnnotation();
        }}
      >
        <option value="">
          {annotations.value.length ? 'no annotation' : 'no recent annotations'}
        </option>
        {annotations.value.map((a) => (
          <option value={String(a.id)}>{a.label}</option>
        ))}
      </select>
      <input
        class={s.input}
        placeholder="or paste an annotation ID or URL"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const el = e.currentTarget as HTMLInputElement;
          pickAnnotation(el.value);
          el.value = '';
        }}
      />
      {id != null && !listed && <span>annotation ({id})</span>}
      {id != null && (
        <button
          type="button"
          class={s.iconBtn}
          data-action="clear-annotation"
          title="Stop showing annotation values"
          onClick={clearAnnotation}
        >
          ✕
        </button>
      )}
      {id != null && !values.value && !annotationError.value && <span class={s.dim}>Loading…</span>}
      {annotationError.value && <span class={s.warn}>{annotationError.value}</span>}
    </div>
  );
}
