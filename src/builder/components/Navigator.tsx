import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import {
  queues,
  workspaces,
  schemas,
  selectedQueueId,
  selectedSchemaId,
  sharedQueueIds,
} from '../store.js';
import { openQueue, openSchema } from '../index.jsx';
import { queueGroups, orphanSchemas } from '../links.js';
import { openCreateDialog } from './CreateDialog.jsx';
import { confirmQueueDelete, confirmSchemaDelete } from './DeleteDialogs.jsx';
import { navDrawer } from './panels.js';
import s from './Builder.module.css';

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
  const [filter, setFilter] = useState('');
  const groups = queueGroups(workspaces.value, queues.value, filter);
  const orphans = orphanSchemas(schemas.value, queues.value, filter);
  const shared = sharedQueueIds.value;
  // With nothing open the list is the way in and stays put; once a schema is open it is a
  // drawer over the grid, opened from the breadcrumb and closed by a pick or a click away.
  const drawer = selectedQueueId.value != null || selectedSchemaId.value != null;
  if (drawer && !navDrawer.value) return null;
  const close = () => (navDrawer.value = false);
  const pickQueue = (id: number) => {
    close();
    openQueue(id);
  };
  const pickSchema = (id: number) => {
    close();
    openSchema(id);
  };
  return (
    <Fragment>
      {drawer && <div class={s.navBackdrop} data-nav-backdrop="" onClick={close} />}
      <nav
        class={s.nav + (drawer ? ' ' + s.navDrawer : '')}
        data-nav-drawer={drawer ? '' : undefined}
      >
        <div class={s.navTop}>
          <input
            class={s.input}
            placeholder="Filter queues and schemas"
            value={filter}
            onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          />
          {drawer && (
            <button
              type="button"
              class={s.iconBtn}
              data-action="close-nav"
              title="Close (Esc)"
              onClick={close}
            >
              ✕
            </button>
          )}
        </div>
        <div class={s.navScroll}>
          <div class={s.groupTitle}>
            Queues
            <button
              type="button"
              class={s.linkBtn}
              data-action="new-workspace"
              onClick={() => openCreateDialog({ kind: 'workspace' })}
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
                    openCreateDialog({
                      kind: 'queue',
                      workspaceUrl: ws.url,
                      workspaceName: ws.name,
                    })
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
                      onClick={() => pickQueue(q.id)}
                      title={isShared ? 'Uses the schema you are editing' : undefined}
                    >
                      {q.name} ({q.id})
                    </button>
                    {/* Deleted in 24 h: the list still returns it until Rossum deletes it. */}
                    {q.status === 'deletion_requested' ? (
                      <span
                        class={s.deleting}
                        data-deleting={String(q.id)}
                        title="Rossum deletes this queue within 24 hours"
                      >
                        Deleting
                      </span>
                    ) : (
                      <DeleteBtn
                        action="delete-queue"
                        data={{ 'data-queue': String(q.id) }}
                        onClick={() => confirmQueueDelete(q)}
                      />
                    )}
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
                onClick={() => openCreateDialog({ kind: 'schema' })}
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
                  onClick={() => pickSchema(x.id)}
                >
                  {x.name} ({x.id})
                </button>
                <DeleteBtn
                  action="delete-schema"
                  data={{ 'data-schema': String(x.id) }}
                  onClick={() => confirmSchemaDelete(x)}
                />
              </div>
            ))}
          </div>
        </div>
      </nav>
    </Fragment>
  );
}
