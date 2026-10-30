import { h, Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { openModal, closeModal, ModalBody, ModalMessage, ModalActions } from '../../ui/Modal.jsx';
import { dirty, selectedQueueId } from '../store.js';
import { deleteQueue, deleteSchema } from '../index.jsx';

// Cancel is the default: it takes the focus, so Enter cancels; Escape cancels too.
function CancelButton() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <button type="button" class="btn btn-secondary" ref={ref} onClick={closeModal}>
      Cancel
    </button>
  );
}

/** Delete a queue in 24 h (Rossum's default, `deletion_requested` meanwhile) or now, for good. */
export function confirmQueueDelete(q: { id: number; name: string }) {
  const run = (now: boolean) => {
    closeModal();
    deleteQueue(q.id, { now });
  };
  openModal('Delete queue', () => (
    <Fragment>
      <ModalBody>
        <ModalMessage>
          Delete queue {q.name} ({q.id})? <b>Delete in 24 h</b> lets Rossum keep it, marked
          Deleting, for 24 hours. <b>Delete now</b> deletes it at once; this cannot be undone.
        </ModalMessage>
        <ModalMessage>
          Its schema is kept, and cannot be deleted while the queue still exists.
        </ModalMessage>
        {selectedQueueId.value === q.id && dirty.value && (
          <ModalMessage>Your staged schema changes are lost.</ModalMessage>
        )}
      </ModalBody>
      <ModalActions footer>
        <CancelButton />
        <button
          type="button"
          class="btn btn-secondary"
          data-action="delete-later"
          onClick={() => run(false)}
        >
          Delete in 24 h
        </button>
        <button
          type="button"
          class="btn btn-danger"
          data-action="delete-now"
          onClick={() => run(true)}
        >
          Delete now
        </button>
      </ModalActions>
    </Fragment>
  ));
}

/** Rossum keeps no deleted schema; the Builder keeps the last one in memory for Undo. */
export function confirmSchemaDelete(x: { id: number; name: string }) {
  openModal('Delete schema', () => (
    <Fragment>
      <ModalBody>
        <ModalMessage>
          Delete schema {x.name} ({x.id})? Rossum deletes it at once. Until you delete another
          schema or reload, Undo creates it again, with a new ID.
        </ModalMessage>
      </ModalBody>
      <ModalActions footer>
        <CancelButton />
        <button
          type="button"
          class="btn btn-danger"
          data-action="confirm-delete"
          onClick={() => {
            closeModal();
            deleteSchema(x.id);
          }}
        >
          Delete
        </button>
      </ModalActions>
    </Fragment>
  ));
}
