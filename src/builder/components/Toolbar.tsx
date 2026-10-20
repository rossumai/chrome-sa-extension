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
  renamed,
  draftName,
  schemaFabry,
} from '../store.js';
import { undoChange, redoChange, discard, renameSchema, openSchemaFabry } from '../index.jsx';
import EditableCell from './EditableCell.jsx';
import FabryMark from '../../ui/FabryMark.jsx';
import { canUndo, canRedo } from '../history.js';
import s from './Builder.module.css';

export function summaryText(
  x: { added: number; edited: number; deleted: number; moved: number },
  renamed = false,
): string {
  return [
    renamed && 'renamed',
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
  const text = summaryText(summary.value, renamed.value);
  return (
    <div class={s.toolbar}>
      <span class={s.crumb}>
        {ws ? `${ws.name} › ` : ''}
        <b>{q ? `${q.name} (${q.id})` : 'No queue'}</b>
        {schema.value && (
          <span class={s.schemaCrumb + (renamed.value ? ' ' + s.renamedItem : '')}>
            {' · schema '}
            <span data-action="rename-schema" title="Click to rename this schema">
              <EditableCell value={draftName.value} onCommit={(v) => renameSchema(v.trim())} />
            </span>{' '}
            ({schema.value.id})
          </span>
        )}
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
        class={s.btn + ' ' + s.fabryBtn}
        data-action="open-schema-fabry"
        title="Ask Mr. Fabry to change the schema"
        onClick={openSchemaFabry}
      >
        <FabryMark size={14} animated={schemaFabry.value.busy} /> Mr. Fabry
      </button>
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
