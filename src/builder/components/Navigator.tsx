import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import {
  queues,
  workspaces,
  schemas,
  selectedQueueId,
  selectedSchemaId,
  sharedQueueIds,
} from '../store.js';
import { openQueue, openSchema, deleteQueue, deleteSchema } from '../index.jsx';
import { queueGroups, orphanSchemas } from '../links.js';
import CreateDialog, { type CreateTarget } from './CreateDialog.jsx';
import s from './Builder.module.css';

const WIDTH_KEY = 'builderNavWidth';
const MIN_WIDTH = 180;
const MAX_WIDTH = 640;
const navWidth = signal(260);
let widthLoaded = false;

function loadWidth() {
  if (widthLoaded) return;
  widthLoaded = true;
  globalThis.chrome?.storage?.local
    ?.get([WIDTH_KEY])
    .then((v) => {
      const w = Number(v?.[WIDTH_KEY]);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) navWidth.value = w;
    })
    .catch(() => {});
}

// Drag the panel's right edge; the width is saved when the drag ends.
function startResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = navWidth.value;
  const onMove = (m: MouseEvent) => {
    navWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + m.clientX - startX));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    globalThis.chrome?.storage?.local?.set({ [WIDTH_KEY]: navWidth.value })?.catch(() => {});
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function DeleteBtn({
  onClick,
  action,
  data,
}: {
  onClick: () => void;
  action: string;
  data: Record<string, string>;
}) {
  return (
    <button
      type="button"
      class={s.iconBtn + ' ' + s.rowDelete}
      data-action={action}
      {...data}
      title="Delete"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      ✕
    </button>
  );
}

// Left panel: queues by workspace, then the schemas no queue uses. Every queue that shares
// the open schema is highlighted, so it is plain which queues an edit changes.
export default function Navigator() {
  useEffect(loadWidth, []);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const groups = queueGroups(workspaces.value, queues.value, filter);
  const orphans = orphanSchemas(schemas.value, queues.value, filter);
  const shared = sharedQueueIds.value;
  return (
    <nav class={s.nav} style={{ width: `${navWidth.value}px` }}>
      <input
        class={s.input}
        placeholder="Filter queues and schemas"
        value={filter}
        onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
      />
      <div class={s.navScroll}>
        <div class={s.groupTitle}>
          Queues
          <button
            type="button"
            class={s.linkBtn}
            data-action="new-workspace"
            onClick={() => setCreating({ kind: 'workspace' })}
          >
            + Workspace
          </button>
        </div>
        {groups.map(({ ws, qs }) => (
          <div key={ws.id}>
            <div class={s.wsName}>
              <span>
                {ws.name} ({ws.id})
              </span>
              <button
                type="button"
                class={s.linkBtn}
                data-action="new-queue"
                data-workspace={ws.url}
                onClick={() =>
                  setCreating({ kind: 'queue', workspaceUrl: ws.url, workspaceName: ws.name })
                }
              >
                + Queue
              </button>
            </div>
            {qs.map((q) => {
              const on = selectedQueueId.value === q.id;
              const isShared = !on && shared.has(q.id);
              return (
                <div
                  key={q.id}
                  class={
                    s.navRow + (on ? ' ' + s.queueOn : '') + (isShared ? ' ' + s.sharedOn : '')
                  }
                >
                  <button
                    type="button"
                    data-queue-id={String(q.id)}
                    data-shared={isShared ? 'true' : undefined}
                    class={s.queue}
                    onClick={() => openQueue(q.id)}
                    title={isShared ? 'Uses the schema you are editing' : undefined}
                  >
                    {q.name} ({q.id})
                  </button>
                  <DeleteBtn
                    action="delete-queue"
                    data={{ 'data-queue': String(q.id) }}
                    onClick={() => deleteQueue(q.id)}
                  />
                </div>
              );
            })}
          </div>
        ))}
        {orphans.length > 0 && (
          <div>
            <div class={s.groupTitle}>Schemas without a queue</div>
            {orphans.map((x) => (
              <div
                key={x.id}
                class={
                  s.navRow +
                  (selectedQueueId.value == null && selectedSchemaId.value === x.id
                    ? ' ' + s.queueOn
                    : '')
                }
              >
                <button
                  type="button"
                  data-schema-id={String(x.id)}
                  class={s.queue}
                  onClick={() => openSchema(x.id)}
                >
                  {x.name} ({x.id})
                </button>
                <DeleteBtn
                  action="delete-schema"
                  data={{ 'data-schema': String(x.id) }}
                  onClick={() => deleteSchema(x.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        class={s.navResizer}
        data-resize="nav"
        title="Drag to resize"
        onMouseDown={(e) => startResize(e as MouseEvent)}
      />
      {creating && <CreateDialog target={creating} onClose={() => setCreating(null)} />}
    </nav>
  );
}
