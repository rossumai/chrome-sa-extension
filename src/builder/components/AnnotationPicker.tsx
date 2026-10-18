import { h } from 'preact';
import { annotations, annotationId, annotationError, values } from '../store.js';
import { pickAnnotation, clearAnnotation } from '../index.jsx';
import s from './Builder.module.css';

// Pick one of the queue's newest annotations, or paste any annotation ID or URL, to see
// its values next to each field.
export default function AnnotationPicker() {
  const id = annotationId.value;
  const listed = annotations.value.some((a) => a.id === id);
  return (
    <div class={s.pickBar}>
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
      {id != null && !listed && <span>annotation {id}</span>}
      {id != null && !values.value && !annotationError.value && <span class={s.dim}>Loading…</span>}
      {annotationError.value && <span class={s.warn}>{annotationError.value}</span>}
    </div>
  );
}
