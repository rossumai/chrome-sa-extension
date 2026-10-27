import { h, Fragment } from 'preact';
import s from './Builder.module.css';

// The foot of the rule and hook editors, which save on their own: the errors, then Close,
// Discard and Save.
export default function DraftFooter({
  what,
  errors,
  dirty,
  saving,
  onClose,
  onDiscard,
  onSave,
}: {
  what: 'rule' | 'hook';
  errors: string[];
  dirty: boolean;
  saving: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Fragment>
      {errors.length > 0 && (
        <div class={s.rowError}>
          {errors.map((m) => (
            <div>{m}</div>
          ))}
        </div>
      )}
      <div class={s.dialogActions}>
        <button type="button" class="btn btn-sm" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          class="btn btn-sm"
          data-action={`discard-${what}`}
          disabled={!dirty}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-action={`save-${what}`}
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : `Save ${what}`}
        </button>
      </div>
    </Fragment>
  );
}
