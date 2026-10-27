import { h } from 'preact';
import {
  annotations,
  annotationId,
  annotationError,
  values,
  revalidating,
  revalidateError,
  validation,
  rightPanel,
} from '../store.js';
import { pickAnnotation, clearAnnotation, revalidate, openValidationPanel } from '../index.jsx';
import { annotationIdFromInput } from '../../rossum/annotationUrl.js';
import SearchPicker from './SearchPicker.jsx';
import s from './Builder.module.css';

// At the right end of the filter bar: one annotation (of the queue's newest, or any pasted
// ID or URL) whose values show in the grid's Value column. One fixed-width field does both,
// so typing or pasting never widens the bar.
export default function AnnotationPicker() {
  const id = annotationId.value;
  const options = annotations.value.map((a) => ({ value: String(a.id), label: a.label }));
  if (id != null && !options.some((o) => o.value === String(id))) {
    options.push({ value: String(id), label: `annotation (${id})` });
  }
  return (
    <span class={s.annoPick}>
      <span class={s.dim}>Values</span>
      <SearchPicker
        picker="annotation"
        value={id != null ? String(id) : ''}
        placeholder={annotations.value.length ? 'recent, or paste ID / URL' : 'paste ID / URL'}
        options={options}
        extra={(text) => {
          const raw = annotationIdFromInput(text);
          return raw && !options.some((o) => o.value === raw)
            ? { value: raw, label: `Open annotation ${raw}` }
            : null;
        }}
        onPick={pickAnnotation}
      />
      {id != null && (
        <button
          type="button"
          class={s.btn}
          data-action="revalidate"
          disabled={revalidating.value}
          title="Run validation on this document (formulas, hooks, rules) without changing a value"
          onClick={revalidate}
        >
          {revalidating.value ? 'Validating…' : '↻ Revalidate'}
        </button>
      )}
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
      {revalidateError.value && <span class={s.warn}>{revalidateError.value}</span>}
      {validation.value && rightPanel.value?.kind !== 'validation' && (
        <button
          type="button"
          class={s.linkBtn}
          data-action="open-validation"
          onClick={() => openValidationPanel()}
        >
          Results
        </button>
      )}
    </span>
  );
}
