import { h } from 'preact';
import { annotationIdFromInput } from '../../rossum/annotationUrl.js';
import ctl from '../../ui/controls.module.css';

export default function IdInput({ onSubmit }: { onSubmit: (value: string) => void }) {
  return (
    <form
      class="inspector-idform"
      onSubmit={(e) => {
        e.preventDefault();
        const raw = e.currentTarget.querySelector('input')?.value;
        const id = annotationIdFromInput(raw);
        if (id) onSubmit(id);
      }}
    >
      <input
        class="inspector-idinput"
        placeholder="Annotation id or Rossum URL"
        spellcheck={false}
      />
      <button class={`${ctl.btn} ${ctl.btnPrimary}`} type="submit">
        Inspect
      </button>
    </form>
  );
}
