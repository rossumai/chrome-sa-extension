import { h } from 'preact';
import {
  history,
  summary,
  dirty,
  selectedQueue,
  schema,
  workspaces,
  sharedCount,
  saving,
} from '../store.js';
import { undoChange, redoChange, discard } from '../index.jsx';
import { canUndo, canRedo } from '../history.js';
import s from './Builder.module.css';

export function summaryText(x: {
  added: number;
  edited: number;
  deleted: number;
  moved: number;
}): string {
  return [
    x.edited && `${x.edited} edited`,
    x.added && `${x.added} new`,
    x.deleted && `${x.deleted} deleted`,
    x.moved && `${x.moved} moved`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function Toolbar({ onSave }: { onSave: () => void }) {
  const q = selectedQueue.value;
  const ws = workspaces.value.find((w) => w.url === q?.workspace);
  const text = summaryText(summary.value);
  return (
    <div class={s.toolbar}>
      <span class={s.crumb}>
        {ws?.name || 'Workspace'} › <b>{q?.name}</b>
        {schema.value && <span class={s.dim}> · schema #{schema.value.id}</span>}
      </span>
      {sharedCount.value > 1 && (
        <span class={s.shared} title="Editing this schema changes every queue that uses it">
          used by {sharedCount.value} queues
        </span>
      )}
      <span class={s.spacer} />
      {text && <span class={s.staged}>{text}</span>}
      <button
        type="button"
        class={s.btn}
        data-action="undo"
        disabled={!canUndo(history.value)}
        onClick={undoChange}
        title="Undo (⌘Z)"
      >
        ↶ Undo
      </button>
      <button
        type="button"
        class={s.btn}
        data-action="redo"
        disabled={!canRedo(history.value)}
        onClick={redoChange}
        title="Redo (⇧⌘Z)"
      >
        ↷ Redo
      </button>
      <button
        type="button"
        class={s.btn}
        data-action="discard"
        disabled={!dirty.value}
        onClick={discard}
      >
        Discard
      </button>
      <button
        type="button"
        class={s.btn + ' ' + s.primary}
        data-action="save"
        disabled={!dirty.value || saving.value}
        onClick={onSave}
      >
        Save schema
      </button>
    </div>
  );
}
