import { h } from 'preact';
import { annotations, annotationId, annotationError, values } from '../store.js';
import { pickAnnotation, clearAnnotation } from '../index.jsx';
import s from './Builder.module.css';

// In the toolbar, next to the schema name: one annotation (of the queue's newest, or any
// pasted ID or URL) whose values show in the grid's Value column.
export default function AnnotationPicker() {
  const id = annotationId.value;
  const listed = annotations.value.some((a) => a.id === id);
  return (
    <span class={s.annoPick}>
      <span class={s.dim}>Values from</span>
      <select
        class={s.select}
        data-picker="annotation"
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
        class={s.input + ' ' + s.pasteId}
        placeholder="or paste ID / URL"
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
    </span>
  );
}
