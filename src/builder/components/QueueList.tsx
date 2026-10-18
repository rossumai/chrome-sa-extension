import { h } from 'preact';
import { useState } from 'preact/hooks';
import { queues, workspaces, selectedQueueId } from '../store.js';
import { openQueue } from '../index.jsx';
import s from './Builder.module.css';

export default function QueueList() {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const groups = workspaces.value
    .map((w) => ({
      ws: w,
      qs: queues.value.filter(
        (q) => q.workspace === w.url && (!f || String(q.name).toLowerCase().includes(f)),
      ),
    }))
    .filter((g) => g.qs.length);
  return (
    <nav class={s.queues}>
      <input
        class={s.input}
        placeholder="Filter queues"
        value={filter}
        onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
      />
      {groups.map(({ ws, qs }) => (
        <div key={ws.id}>
          <div class={s.wsName}>{ws.name}</div>
          {qs.map((q) => (
            <button
              type="button"
              key={q.id}
              class={s.queue + (selectedQueueId.value === q.id ? ' ' + s.queueOn : '')}
              onClick={() => openQueue(q.id)}
              title={`Queue ${q.id}`}
            >
              {q.name}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
