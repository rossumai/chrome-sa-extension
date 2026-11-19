import { h } from 'preact';
import { useState } from 'preact/hooks';
import {
  openModal,
  closeModal,
  ModalBody,
  ModalActions,
  ModalMessage,
  ModalFieldLabel,
} from '../../../ui/Modal.jsx';
import * as store from '../store.js';
import ctl from '../../../ui/controls.module.css';
import styles from './PdfDialog.module.css';

// Asked every time: which scope. Remembered: what the document includes.
//
// The owner chose "ask at click time" for scope and "consider making this configurable" for
// the extras — so the scope is a fresh decision (it changes per use) while the content
// options persist in store.pdfOptions and are never re-asked.
type PdfScope = { deliverableTitle?: string; count: number };

function PdfForm({
  deliverableTitle,
  count,
  onConfirm,
}: PdfScope & { onConfirm: (choice: any) => void }) {
  const [scope, setScope] = useState(count > 1 ? 'all' : 'one');
  const [opts, setOpts] = useState(store.pdfOptions.value);
  const toggle = (k: any) => setOpts((o) => ({ ...o, [k]: !(o as any)[k] }));
  const many = scope === 'all' && count > 1;

  return (
    <ModalBody>
      <ModalMessage>
        {'Opens a print-ready page and the browser’s print dialog — choose '}
        <strong>{'Save as PDF'}</strong>
        {' there. An extension cannot write the file itself.'}
      </ModalMessage>

      <ModalFieldLabel>{'What to print'}</ModalFieldLabel>
      <label class={styles.pdfRow}>
        <input
          type="radio"
          name="pdf-scope"
          checked={scope === 'one'}
          onChange={() => setScope('one')}
        />
        <span>
          {'This deliverable'}
          <span class={styles.pdfHint}>{deliverableTitle}</span>
        </span>
      </label>
      <label class={styles.pdfRow}>
        <input
          type="radio"
          name="pdf-scope"
          checked={scope === 'all'}
          disabled={count < 2}
          onChange={() => setScope('all')}
        />
        <span>
          {'Whole specification'}
          <span class={styles.pdfHint}>
            {count < 2 ? 'only one deliverable exists' : `${count} deliverables, one after another`}
          </span>
        </span>
      </label>

      <ModalFieldLabel>{'Include'}</ModalFieldLabel>
      <label class={styles.pdfRow + (many ? '' : ' ' + styles.off)}>
        <input
          type="checkbox"
          checked={opts.contents}
          disabled={!many}
          onChange={() => toggle('contents')}
        />
        <span>
          {'Contents page'}
          <span class={styles.pdfHint}>
            {many ? 'a list of the documents, first page' : 'needs more than one document'}
          </span>
        </span>
      </label>
      <label class={styles.pdfRow}>
        <input type="checkbox" checked={opts.verdicts} onChange={() => toggle('verdicts')} />
        <span>
          {'Check verdict'}
          <span class={styles.pdfHint}>{'the last ✓ Met / ✗ Not met from Fabry'}</span>
        </span>
      </label>

      <ModalActions>
        <button type="button" class={`${ctl.btn} ${ctl.btnSecondary}`} onClick={closeModal}>
          {'Cancel'}
        </button>
        <button
          type="button"
          class={`${ctl.btn} ${ctl.btnPrimary}`}
          onClick={() => {
            store.setPdfOptions(opts); // remembered for next time
            closeModal();
            onConfirm({ scope, options: opts });
          }}
        >
          {'Open print dialog'}
        </button>
      </ModalActions>
    </ModalBody>
  );
}

export function openPdfDialog({ deliverableTitle, count }: PdfScope, onConfirm: any) {
  openModal('Print / save as PDF', () => h(PdfForm, { deliverableTitle, count, onConfirm }));
}
