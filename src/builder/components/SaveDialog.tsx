import { h } from 'preact';
import { useState } from 'preact/hooks';
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
import { summaryText } from './Toolbar.jsx';
import s from './Builder.module.css';

export default function SaveDialog({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const run = async (force: boolean) => {
    const r = await save(force);
    if (!r || (!r.ok && r.stage !== 'stale')) {
      onClose(); // errors are shown on the rows and in the banner
      return;
    }
    setResult(r);
  };
  return (
    <div class={s.overlay} onClick={() => !saving.value && onClose()}>
      <div
        class={s.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Save schema"
      >
        <h3 class={s.dialogTitle}>Save schema</h3>
        {!result && (
          <div>
            <p>{summaryText(summary.value, renamed.value)}</p>
            {sharedCount.value > 1 && (
              <p class={s.warn}>
                This schema is used by {sharedCount.value} queues. All of them change.
              </p>
            )}
            {enginePlanNow.value &&
              enginePlanNow.value.create.length +
                enginePlanNow.value.patch.length +
                engineDeletesNow.value.length >
                0 && (
                <div data-engine-plan="">
                  <p>
                    Engine fields first
                    {enginePlanNow.value.create.length > 0 &&
                      ` · create ${enginePlanNow.value.create.map((c) => c.name).join(', ')}`}
                    {enginePlanNow.value.patch.length > 0 &&
                      ` · update ${enginePlanNow.value.patch.map((p) => p.name).join(', ')}`}
                    {engineDeletesNow.value.length > 0 &&
                      ` · delete ${engineDeletesNow.value.map((f) => f.name).join(', ')}`}
                  </p>
                  <p class={s.dim}>
                    They are saved before the schema. If Rossum then rejects the schema, they stay
                    and the next Save reuses them.
                  </p>
                </div>
              )}
            <p class={s.dim}>
              Builder validates the schema first and saves nothing if Rossum rejects it.
            </p>
            <div class={s.dialogActions}>
              <button type="button" class={s.btn} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                class={s.btn + ' ' + s.primary}
                disabled={saving.value}
                data-action="confirm-save"
                onClick={() => run(false)}
              >
                {saving.value ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div>
            <p class={s.warn}>{result.errors[0]?.message}</p>
            <div class={s.dialogActions}>
              <button type="button" class={s.btn} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                class={s.btn + ' ' + s.primary}
                disabled={saving.value}
                onClick={() => run(true)}
              >
                Save anyway
              </button>
            </div>
          </div>
        )}
        {result && result.ok && (
          <div>
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
            <div class={s.dialogActions}>
              <button type="button" class={s.btn + ' ' + s.primary} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
