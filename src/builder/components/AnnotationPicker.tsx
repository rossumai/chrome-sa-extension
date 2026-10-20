import { h, Fragment } from 'preact';
import {
  annotations,
  annotationId,
  annotationError,
  values,
  fieldFilter,
  work,
  rules,
  ruleId,
  ruleRefs,
  selectedQueueId,
} from '../store.js';
import { flatten } from '../model.js';
import { countMatches } from '../fieldFilter.js';
import { pickAnnotation, clearAnnotation, openRuleEditor } from '../index.jsx';
import s from './Builder.module.css';

// The bar above the grid: a field filter (id or label); an annotation (one of the queue's
// newest, or any pasted ID or URL) whose values show next to each field; and a rule whose
// fields are highlighted.
export default function AnnotationPicker() {
  const id = annotationId.value;
  const listed = annotations.value.some((a) => a.id === id);
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
      {selectedQueueId.value != null && (
        <Fragment>
          <span class={s.barGap} />
          <span class={s.dim}>Rule</span>
          <select
            class={s.select}
            data-picker="rule"
            value={ruleId.value != null ? String(ruleId.value) : ''}
            title={rules.value.find((r) => r.id === ruleId.value)?.trigger_condition || ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              ruleId.value = v ? Number(v) : null;
            }}
          >
            <option value="">{rules.value.length ? 'no rule' : 'no rules on this queue'}</option>
            {rules.value.map((r) => (
              <option value={String(r.id)}>
                {r.name} ({r.id}){r.enabled === false ? ' · disabled' : ''}
              </option>
            ))}
          </select>
          {ruleId.value != null && (
            <button
              type="button"
              class={s.linkBtn}
              data-action="edit-rule"
              onClick={() => openRuleEditor(ruleId.value)}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            class={s.linkBtn}
            data-action="new-rule"
            onClick={() => openRuleEditor(null)}
          >
            + Rule
          </button>
          {ruleId.value != null && (
            <button
              type="button"
              class={s.iconBtn}
              data-action="clear-rule"
              title="Stop highlighting this rule's fields"
              onClick={() => (ruleId.value = null)}
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
    </div>
  );
}
