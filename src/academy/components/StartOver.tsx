import { h } from 'preact';
import * as store from '../store.js';
import { openModal, closeModal, ModalBody, ModalActions, ModalMessage } from '../../ui/Modal.jsx';
import type { RunObject } from '../cleanup.js';
import css from '../Academy.module.css';
import ctl from '../../ui/controls.module.css';

const KIND: Record<RunObject['kind'], string> = {
  rule: 'Rule',
  extension: 'Extension',
  queue: 'Queue, with its documents',
  schema: 'Schema',
  dataset: 'Dataset',
};

function ItemList({ items, failed }: { items: RunObject[]; failed?: Map<RunObject, string> }) {
  return (
    <ul class={css.startList}>
      {items.map((it) => (
        <li key={`${it.kind}:${it.id ?? it.name}`}>
          <span class={css.startKind}>{KIND[it.kind]}</span> <code>{it.name}</code>
          {it.id != null && <span class={css.startId}> {it.id}</span>}
          {failed?.has(it) && <span class={css.startFail}> {failed.get(it)}</span>}
        </li>
      ))}
    </ul>
  );
}

function Body() {
  const s = store.startOver.value;
  const run = store.progress.value?.run;
  if (!s || s.phase === 'loading') {
    return (
      <ModalBody>
        <ModalMessage>Looking up what run {run} built in your organization…</ModalMessage>
      </ModalBody>
    );
  }
  if (s.phase === 'error') {
    return (
      <ModalBody>
        <ModalMessage>
          Could not read your organization ({s.message}), so nothing can be deleted from here. You
          can still start a new run: run {run}
          {'’'}s objects stay, and no check counts them.
        </ModalMessage>
        <ModalActions>
          <button type="button" class={`${ctl.btn} ${ctl.btnSecondary}`} onClick={closeModal}>
            Cancel
          </button>
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnSecondary}`}
            onClick={async () => {
              await store.startOverKeeping();
              closeModal();
            }}
          >
            Keep them, start a new run
          </button>
        </ModalActions>
      </ModalBody>
    );
  }
  const working = s.phase === 'working';
  const failed =
    s.phase === 'failed' ? new Map(s.failed.map((f) => [f.item, f.message])) : undefined;
  const items = s.phase === 'failed' ? s.failed.map((f) => f.item) : s.items;
  return (
    <ModalBody>
      <ModalMessage>
        A new run gets a new code, and the Academy checks only what carries it. Your progress
        {store.progress.value?.receipt ? ' and your completion summary are' : ' is'} cleared either
        way.
      </ModalMessage>
      {s.phase === 'failed' ? (
        <ModalMessage>
          These could not be deleted, so run {run} is kept. Retry, or delete them in Rossum and
          start a new run.
        </ModalMessage>
      ) : items.length ? (
        <ModalMessage>Run {run} built these, still in your organization:</ModalMessage>
      ) : (
        <ModalMessage>Run {run} left nothing in your organization.</ModalMessage>
      )}
      {items.length > 0 && <ItemList items={items} failed={failed} />}
      <ModalActions>
        <button
          type="button"
          class={`${ctl.btn} ${ctl.btnSecondary}`}
          disabled={working}
          onClick={closeModal}
        >
          Cancel
        </button>
        <button
          type="button"
          class={`${ctl.btn} ${ctl.btnSecondary}`}
          disabled={working}
          onClick={async () => {
            await store.startOverKeeping();
            closeModal();
          }}
        >
          Keep them, start a new run
        </button>
        {items.length > 0 && (
          <button
            type="button"
            class={`${ctl.btn} ${ctl.btnDanger}`}
            disabled={working}
            onClick={async () => {
              await store.startOverDeleting();
              if (!store.startOver.value) closeModal();
            }}
          >
            {working
              ? 'Deleting…'
              : s.phase === 'failed'
                ? 'Retry deleting'
                : 'Delete them and start a new run'}
          </button>
        )}
      </ModalActions>
    </ModalBody>
  );
}

export function openStartOverDialog() {
  openModal('Start over', () => <Body />);
  store.openStartOver();
}
