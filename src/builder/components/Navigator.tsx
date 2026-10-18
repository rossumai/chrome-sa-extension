import { h } from 'preact';
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
import s from './Builder.module.css';

// Left panel: queues by workspace, then the schemas no queue uses. Every queue that shares
// the open schema is highlighted, so it is plain which queues an edit changes.
export default function Navigator() {
  const [filter, setFilter] = useState('');
  const groups = queueGroups(workspaces.value, queues.value, filter);
  const orphans = orphanSchemas(schemas.value, queues.value, filter);
  const shared = sharedQueueIds.value;
  return (
    <nav class={s.nav}>
      <input
        class={s.input}
        placeholder="Filter queues and schemas"
        value={filter}
        onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
      />
      <div class={s.navScroll}>
        <div class={s.groupTitle}>Queues</div>
        {groups.map(({ ws, qs }) => (
          <div key={ws.id}>
            <div class={s.wsName}>
              {ws.name} ({ws.id})
            </div>
            {qs.map((q) => {
              const on = selectedQueueId.value === q.id;
              const isShared = !on && shared.has(q.id);
              return (
                <button
                  type="button"
                  key={q.id}
                  data-queue-id={String(q.id)}
                  data-shared={isShared ? 'true' : undefined}
                  class={s.queue + (on ? ' ' + s.queueOn : '') + (isShared ? ' ' + s.sharedOn : '')}
                  onClick={() => openQueue(q.id)}
                  title={isShared ? 'Uses the schema you are editing' : undefined}
                >
                  {q.name} ({q.id})
                </button>
              );
            })}
          </div>
        ))}
        {orphans.length > 0 && (
          <div>
            <div class={s.groupTitle}>Schemas without a queue</div>
            {orphans.map((x) => (
              <button
                type="button"
                key={x.id}
                data-schema-id={String(x.id)}
                class={
                  s.queue +
                  (selectedQueueId.value == null && selectedSchemaId.value === x.id
                    ? ' ' + s.queueOn
                    : '')
                }
                onClick={() => openSchema(x.id)}
              >
                {x.name} ({x.id})
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
