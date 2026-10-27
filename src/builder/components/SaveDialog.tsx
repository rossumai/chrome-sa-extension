import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { closeModal, ModalBody, ModalActions } from '../../ui/Modal.jsx';
import {
  summary,
  saving,
  sharedCount,
  renamed,
  enginePlanNow,
  engineDeletesNow,
} from '../store.js';
import { save } from '../index.jsx';
import type { SaveResult } from '../save.js';
import { summaryText } from '../model.js';
import s from './Builder.module.css';

// Opened in the shared modal (title "Save schema"); errors land on the rows and in the banner.
export default function SaveDialog() {
  const [result, setResult] = useState<SaveResult | null>(null);
  const run = async (force: boolean) => {
    const r = await save(force);
    if (!r || (!r.ok && r.stage !== 'stale')) {
      closeModal(); // errors are shown on the rows and in the banner
      return;
    }
    setResult(r);
  };
  if (!result) {
    const plan = enginePlanNow.value;
    return (
      <Fragment>
        <ModalBody>
          <p>{summaryText(summary.value, renamed.value)}</p>
          {sharedCount.value > 1 && (
            <p class={s.warn}>
              This schema is used by {sharedCount.value} queues. All of them change.
            </p>
          )}
          {plan && plan.create.length + plan.patch.length + engineDeletesNow.value.length > 0 && (
            <div data-engine-plan="">
              <p>
                Engine fields first
                {plan.create.length > 0 && ` · create ${plan.create.map((c) => c.name).join(', ')}`}
                {plan.patch.length > 0 && ` · update ${plan.patch.map((p) => p.name).join(', ')}`}
                {engineDeletesNow.value.length > 0 &&
                  ` · delete ${engineDeletesNow.value.map((f) => f.name).join(', ')}`}
              </p>
              <p class={s.dim}>
                They are saved before the schema. If Rossum then rejects the schema, they stay and
                the next Save reuses them.
              </p>
            </div>
          )}
          <p class={s.dim}>
            Builder validates the schema first and saves nothing if Rossum rejects it.
          </p>
        </ModalBody>
        <ModalActions footer>
          <button type="button" class="btn btn-secondary" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={saving.value}
            data-action="confirm-save"
            onClick={() => run(false)}
          >
            {saving.value ? 'Saving…' : 'Save'}
          </button>
        </ModalActions>
      </Fragment>
    );
  }
  if (!result.ok) {
    return (
      <Fragment>
        <ModalBody>
          <p class={s.warn}>{result.errors[0]?.message}</p>
        </ModalBody>
        <ModalActions footer>
          <button type="button" class="btn btn-secondary" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={saving.value}
            onClick={() => run(true)}
          >
            Save anyway
          </button>
        </ModalActions>
      </Fragment>
    );
  }
  return (
    <Fragment>
      <ModalBody>
        <p>Saved.</p>
        {result.warnings.length > 0 && (
          <div class={s.warn}>
            These values did not land as sent:
            <ul>
              {result.warnings.map((w) => (
                <li class={s.mono}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </ModalBody>
      <ModalActions footer>
        <button type="button" class="btn btn-primary" onClick={closeModal}>
          Close
        </button>
      </ModalActions>
    </Fragment>
  );
}
