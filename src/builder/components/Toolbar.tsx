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
  engineState,
  engineChanges,
  enginePanel,
  work,
} from '../store.js';
import {
  undoChange,
  redoChange,
  discard,
  renameSchema,
  openSchemaFabry,
  openEnginePanel,
  closeEnginePanel,
} from '../index.jsx';
import EditableCell from './EditableCell.jsx';
import FabryMark from '../../ui/FabryMark.jsx';
import { navDrawer } from './panels.js';
import { unusedEngineFields } from '../engine.js';
import Icon from './icons.jsx';
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

// The queue's extraction engine; for a custom one, its settings and unused fields on hover and
// a click opens the engine panel.
function EngineBadge() {
  const es = engineState.value;
  if (!es || es.kind === 'none') return null;
  if (es.kind !== 'custom') {
    return (
      <span class={s.engineBadge} data-engine={es.kind}>
        {es.kind === 'generic' ? 'Generic engine' : 'Dedicated engine'}
      </span>
    );
  }
  const e = es.engine;
  const unused = e ? unusedEngineFields(work.value, es.fields) : [];
  const open = enginePanel.value;
  return (
    <button
      type="button"
      class={s.engineBadge + ' ' + s.aiBtn + (es.error ? ' ' + s.warn : '')}
      data-engine="custom"
      data-action="toggle-engine"
      aria-pressed={open ? 'true' : 'false'}
      title={
        e
          ? [
              `${e.name} (${e.id})`,
              `use case: ${e.settings?.use_case ?? 'not set'}`,
              `learning: ${e.learning_enabled ? 'on' : 'off'}`,
              `${es.fields.length} engine fields`,
              unused.length ? `not in this schema: ${unused.map((f) => f.name).join(', ')}` : '',
              open ? 'Click to close the engine panel' : 'Click to edit the engine fields',
            ]
              .filter(Boolean)
              .join('\n')
          : (es.error ?? '')
      }
      onClick={() => (open ? closeEnginePanel() : openEnginePanel())}
    >
      {e ? `Engine: ${e.name} (${e.id})` : es.error ? 'Engine did not load' : 'Engine…'}
    </button>
  );
}

export default function Toolbar({ onSave }: { onSave: () => void }) {
  const q = selectedQueue.value;
  const ws = workspaces.value.find((w) => w.url === q?.workspace);
  const text = [
    summaryText(summary.value, renamed.value),
    engineChanges.value &&
      `${engineChanges.value} engine field${engineChanges.value === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div class={s.toolbar} data-toolbar="">
      <button
        type="button"
        class={s.iconBtn + ' ' + s.navOpen}
        data-action="open-nav"
        title="Queues and schemas"
        onClick={() => (navDrawer.value = true)}
      >
        <Icon name="menu" />
      </button>
      <span
        class={s.crumb}
        title={[
          ws ? `${ws.name} › ` : '',
          q ? `${q.name} (${q.id})` : 'No queue',
          schema.value ? ` · schema ${draftName.value} (${schema.value.id})` : '',
        ].join('')}
      >
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
      <EngineBadge />
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
        <FabryMark size={14} animated={schemaFabry.value.busy} />
      </button>
      <button
        type="button"
        class={s.btn + ' ' + s.fabryBtn}
        data-action="undo"
        disabled={!canUndo(history.value)}
        onClick={undoChange}
        title="Undo (⌘Z)"
      >
        <Icon name="undo" size={14} />
      </button>
      <button
        type="button"
        class={s.btn + ' ' + s.fabryBtn}
        data-action="redo"
        disabled={!canRedo(history.value)}
        onClick={redoChange}
        title="Redo (⇧⌘Z)"
      >
        <Icon name="redo" size={14} />
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
