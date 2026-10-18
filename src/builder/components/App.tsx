import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  error,
  retryable,
  loading,
  schema,
  selectedQueueId,
  generalErrors,
  queues,
} from '../store.js';
import { undoChange, redoChange, loadQueues, openQueue } from '../index.jsx';
import QueueList from './QueueList.jsx';
import Toolbar from './Toolbar.jsx';
import Grid from './Grid.jsx';
import Inspector from './Inspector.jsx';
import SaveDialog from './SaveDialog.jsx';
import s from './Builder.module.css';

function inField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  // Text entry only: a focused switch or select must not swallow ⌘Z after a change.
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox';
}

export default function App({ connected }: { connected: boolean | null }) {
  const [saveOpen, setSaveOpen] = useState(false);

  // ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo — not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || inField(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undoChange();
      else if ((k === 'z' && e.shiftKey) || k === 'y') redoChange();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!connected) {
    return (
      <div class="app-root">
        <div class="empty-state">
          {error.value || 'Open the Console from a Rossum tab to connect.'}
        </div>
      </div>
    );
  }

  const retry = () => {
    if (!queues.value.length) loadQueues();
    else if (selectedQueueId.value != null && !schema.value) openQueue(selectedQueueId.value);
    else error.value = null;
  };

  return (
    <div class={'app-root ' + s.root}>
      <QueueList />
      <main class={s.main}>
        {error.value && (
          <div class={s.banner}>
            {error.value}
            {retryable.value && (
              <button type="button" class={s.btn} onClick={retry}>
                Retry
              </button>
            )}
          </div>
        )}
        {generalErrors.value.length > 0 && (
          <div class={s.banner}>
            {generalErrors.value.map((m) => (
              <div>{m}</div>
            ))}
          </div>
        )}
        {selectedQueueId.value == null ? (
          <div class="empty-state">
            {loading.value ? 'Loading queues…' : 'Pick a queue to edit its schema.'}
          </div>
        ) : !schema.value ? (
          <div class="empty-state">{loading.value ? 'Loading schema…' : ''}</div>
        ) : (
          <div class={s.editor}>
            <Toolbar onSave={() => setSaveOpen(true)} />
            <div class={s.body}>
              <div class={s.gridWrap}>
                <Grid />
              </div>
              <Inspector />
            </div>
          </div>
        )}
      </main>
      {saveOpen && <SaveDialog onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
