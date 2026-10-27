import { h, Fragment, type ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { openModal, closeModal, ModalBody, ModalField, ModalActions } from '../../ui/Modal.jsx';
import { schema, schemas, saving } from '../store.js';
import { createWorkspace, createQueue, createUnlinkedSchema, type NewQueue } from '../index.jsx';
import s from './Builder.module.css';

export type CreateTarget =
  | { kind: 'workspace' }
  | { kind: 'schema' }
  | { kind: 'queue'; workspaceUrl: string; workspaceName: string };

/** Opens the dialog for "+ Workspace", "+ Queue" or "+ Schema" in the shared modal. */
export function openCreateDialog(target: CreateTarget) {
  const title =
    target.kind === 'workspace'
      ? 'New workspace'
      : target.kind === 'schema'
        ? 'New schema (no queue)'
        : `New queue in ${target.workspaceName}`;
  openModal(title, () => <CreateDialog target={target} />);
}

// One small form for "+ Workspace", "+ Queue" and "+ Schema". A new queue's schema is a copy
// of the open schema (as saved), an existing schema it will share, or a new schema with one
// empty section; a new schema with no queue is a copy or empty.
export default function CreateDialog({ target }: { target: CreateTarget }) {
  const open = schema.value;
  const [name, setName] = useState('');
  const [mode, setMode] = useState<NewQueue['mode']>(open ? 'copy' : 'empty');
  const [shareUrl, setShareUrl] = useState<string>(open?.url ?? schemas.value[0]?.url ?? '');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Once: an inline ref callback would re-run every render and pull focus back here.
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async () => {
    if (!name.trim() || busy || saving.value) return;
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
    if (ok) closeModal();
  };

  const radio = (value: NewQueue['mode'], label: ComponentChildren, disabled = false) => (
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
    <Fragment>
      <ModalBody>
        <ModalField label="Name">
          <input
            class={s.input}
            value={name}
            ref={nameRef}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </ModalField>
        {target.kind !== 'workspace' && (
          <ModalField label="Schema">
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
          </ModalField>
        )}
      </ModalBody>
      <ModalActions footer>
        <button type="button" class="btn btn-secondary" onClick={closeModal} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-action="create"
          disabled={!name.trim() || busy || saving.value}
          onClick={submit}
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </ModalActions>
    </Fragment>
  );
}
