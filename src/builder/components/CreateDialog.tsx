import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { schema, schemas, saving } from '../store.js';
import { createWorkspace, createQueue, createUnlinkedSchema, type NewQueue } from '../index.jsx';
import s from './Builder.module.css';

export type CreateTarget =
  | { kind: 'workspace' }
  | { kind: 'schema' }
  | { kind: 'queue'; workspaceUrl: string; workspaceName: string };

// One small form for "+ Workspace", "+ Queue" and "+ Schema". A new queue's schema is a copy
// of the open schema (as saved), an existing schema it will share, or a new schema with one
// empty section; a new schema with no queue is a copy or empty.
export default function CreateDialog({
  target,
  onClose,
}: {
  target: CreateTarget;
  onClose: () => void;
}) {
  const open = schema.value;
  const [name, setName] = useState('');
  const [mode, setMode] = useState<NewQueue['mode']>(open ? 'copy' : 'empty');
  const [shareUrl, setShareUrl] = useState<string>(open?.url ?? schemas.value[0]?.url ?? '');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Once: an inline ref callback would re-run every render and pull focus back here.
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const n = name.trim();
    const ok =
      target.kind === 'workspace'
        ? await createWorkspace(n)
        : target.kind === 'schema'
          ? await createUnlinkedSchema(n, mode === 'copy' ? 'copy' : 'empty')
          : await createQueue({
              name: n,
              workspaceUrl: target.workspaceUrl,
              mode,
              schemaUrl: mode === 'share' ? shareUrl : undefined,
            });
    setBusy(false);
    if (ok) onClose();
  };

  const radio = (value: NewQueue['mode'], label: any, disabled = false) => (
    <label class={s.checkField}>
      <input
        type="radio"
        name="schema-mode"
        value={value}
        checked={mode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
      />
      {label}
    </label>
  );

  return (
    <div class={s.overlay} onClick={() => !busy && onClose()}>
      <div class={s.dialog} onClick={(e) => e.stopPropagation()} role="dialog">
        <form onSubmit={submit}>
          <h3 class={s.dialogTitle}>
            {target.kind === 'workspace'
              ? 'New workspace'
              : target.kind === 'schema'
                ? 'New schema (no queue)'
                : `New queue in ${target.workspaceName}`}
          </h3>
          <label class={s.field}>
            <span class={s.fieldLabel}>Name</span>
            <input
              class={s.input}
              value={name}
              ref={nameRef}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {target.kind !== 'workspace' && (
            <div class={s.field}>
              <span class={s.fieldLabel}>Schema</span>
              {radio(
                'copy',
                open
                  ? `Copy of ${open.name} (${open.id}), as saved`
                  : 'Copy of the open schema (none open)',
                !open,
              )}
              {target.kind === 'queue' &&
                radio('share', 'Share an existing schema', !schemas.value.length)}
              {target.kind === 'queue' && mode === 'share' && (
                <select
                  class={s.select}
                  value={shareUrl}
                  onChange={(e) => setShareUrl((e.currentTarget as HTMLSelectElement).value)}
                >
                  {schemas.value.map((x) => (
                    <option value={x.url}>
                      {x.name} ({x.id})
                    </option>
                  ))}
                </select>
              )}
              {radio('empty', 'New schema with one empty section')}
            </div>
          )}
          <div class={s.dialogActions}>
            <button type="button" class={s.btn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              class={s.btn + ' ' + s.primary}
              disabled={!name.trim() || busy || saving.value}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
