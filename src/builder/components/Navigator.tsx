import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
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
import { widthPref } from './widthPref.js';
import s from './Builder.module.css';

const nav = widthPref('builderNavWidth', 260, 180, 640);

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
  useEffect(nav.load, []);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const groups = queueGroups(workspaces.value, queues.value, filter);
  const orphans = orphanSchemas(schemas.value, queues.value, filter);
  const shared = sharedQueueIds.value;
  return (
    <nav class={s.nav} style={{ width: `${nav.width.value}px` }}>
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
        <div>
          <div class={s.groupTitle}>
            Schemas without a queue
            <button
              type="button"
              class={s.linkBtn}
              data-action="new-schema"
              onClick={() => setCreating({ kind: 'schema' })}
            >
              + Schema
            </button>
          </div>
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
      </div>
      <div
        class={s.navResizer}
        data-resize="nav"
        title="Drag to resize"
        onMouseDown={(e) => nav.start(e as MouseEvent)}
      />
      {creating && <CreateDialog target={creating} onClose={() => setCreating(null)} />}
    </nav>
  );
}
