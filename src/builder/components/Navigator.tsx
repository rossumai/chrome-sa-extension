import { h } from 'preact';
import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import {
  queues,
  workspaces,
  schemas,
  selectedQueueId,
  schema,
  draftName,
  renamed,
} from '../store.js';
import { openQueue, renameSchema } from '../index.jsx';
import { queueGroups, schemaItems } from '../links.js';
import EditableCell from './EditableCell.jsx';
import s from './Builder.module.css';

type Link = { schemaId: number; queueId: number; y1: number; y2: number };

const LINES_WIDTH = 36;

// Schemas on the left, queues on the right, one line per queue to the schema it uses.
// Both lists scroll together, so a line's ends are the items' offsets in that container.
export default function Navigator() {
  const [filter, setFilter] = useState('');
  const groups = queueGroups(workspaces.value, queues.value, filter);
  const items = schemaItems(schemas.value, groups);
  const openId = schema.value?.id ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [height, setHeight] = useState(0);

  const measure = () => {
    const root = scrollRef.current;
    if (!root) return;
    const mid = (el: HTMLElement | null) => (el ? el.offsetTop + el.offsetHeight / 2 : 0);
    const next: Link[] = [];
    for (const it of items) {
      const se = root.querySelector<HTMLElement>(`[data-schema-id="${it.id}"]`);
      for (const qid of it.queueIds) {
        const qe = root.querySelector<HTMLElement>(`[data-queue-id="${qid}"]`);
        next.push({ schemaId: it.id, queueId: qid, y1: mid(se), y2: mid(qe) });
      }
    }
    setLinks(next);
    setHeight(root.scrollHeight);
  };

  const key = items.map((i) => `${i.id}:${i.queueIds.join(',')}`).join('|') + `|${renamed.value}`;
  useLayoutEffect(measure, [key]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !scrollRef.current) return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [key]);

  return (
    <nav class={s.nav}>
      <input
        class={s.input}
        placeholder="Filter queues"
        value={filter}
        onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
      />
      <div class={s.navCols}>
        <span class={s.wsName}>Schemas</span>
        <span />
        <span class={s.wsName}>Queues</span>
      </div>
      <div class={s.navScroll} ref={scrollRef}>
        <div class={s.navCols}>
          <div class={s.schemaCol}>
            {items.map((it) => {
              const open = it.id === openId;
              return (
                <div
                  key={it.id}
                  data-schema-id={String(it.id)}
                  aria-current={open ? 'true' : undefined}
                  class={
                    s.schemaItem +
                    (open ? ' ' + s.queueOn : '') +
                    (open && renamed.value ? ' ' + s.renamedItem : '') +
                    (!it.queueIds.length ? ' ' + s.unused : '')
                  }
                  title={
                    it.queueIds.length
                      ? `Schema ${it.id} · ${it.queueIds.length} queue(s)`
                      : `Schema ${it.id} · no queue in this list uses it`
                  }
                  onClick={() => !open && it.queueIds.length && openQueue(it.queueIds[0])}
                >
                  {open ? (
                    <EditableCell
                      value={draftName.value}
                      onCommit={(v) => renameSchema(v.trim())}
                    />
                  ) : (
                    it.name
                  )}
                </div>
              );
            })}
          </div>
          <svg class={s.lines} width={LINES_WIDTH} height={height}>
            {links.map((l) => {
              const on = l.schemaId === openId;
              const d = `M0 ${l.y1} C ${LINES_WIDTH / 2} ${l.y1}, ${LINES_WIDTH / 2} ${l.y2}, ${LINES_WIDTH} ${l.y2}`;
              return (
                <path
                  data-link=""
                  d={d}
                  class={on ? s.lineOn : s.line}
                  key={`${l.schemaId}-${l.queueId}`}
                />
              );
            })}
          </svg>
          <div class={s.queueCol}>
            {groups.map(({ ws, qs }) => (
              <div key={ws.id}>
                <div class={s.wsName}>{ws.name}</div>
                {qs.map((q) => (
                  <button
                    type="button"
                    key={q.id}
                    data-queue-id={String(q.id)}
                    class={s.queue + (selectedQueueId.value === q.id ? ' ' + s.queueOn : '')}
                    onClick={() => openQueue(q.id)}
                    title={`Queue ${q.id}`}
                  >
                    {q.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
