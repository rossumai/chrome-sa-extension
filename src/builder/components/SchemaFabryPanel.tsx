import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { schemaFabry, fabryChangedKeys, onlyFabryChanges } from '../store.js';
import { askSchemaFabry, closeSchemaFabry, fixWithFabry } from '../index.jsx';
import AskFabry from './AskFabry.jsx';
import { rightPanel } from './panels.js';
import s from './Builder.module.css';

// Mr. Fabry for the whole schema: the conversation, what each answer changed, what is still
// wrong (with "Ask Mr. Fabry to fix"), and a filter down to the rows it touched.
export default function SchemaFabryPanel() {
  useEffect(rightPanel.load, []);
  const st = schemaFabry.value;
  const changed = fabryChangedKeys.value.size;
  return (
    <aside
      class={s.inspector}
      style={{ width: `${rightPanel.width.value}px` }}
      data-panel="schema-fabry"
    >
      <div
        class={s.inspectorResizer}
        data-resize="inspector"
        onMouseDown={(e) => rightPanel.start(e as MouseEvent, -1)}
      />
      <div class={s.ruleHead}>
        <h4 class={s.inspTitle}>Mr. Fabry · schema</h4>
        <button
          type="button"
          class={s.iconBtn}
          data-action="close-schema-fabry"
          title="Close (Esc)"
          onClick={closeSchemaFabry}
        >
          ✕
        </button>
      </div>
      <div class={s.dim}>
        Changes land as one edit: highlighted like your own, undone with one Undo, saved only with
        Save schema.
      </div>
      <label class={s.checkField}>
        <input
          type="checkbox"
          data-action="only-fabry"
          checked={onlyFabryChanges.value}
          disabled={!changed}
          onChange={(e) => (onlyFabryChanges.value = (e.currentTarget as HTMLInputElement).checked)}
        />
        Only Mr. Fabry's changes{changed ? ` (${changed})` : ''}
      </label>
      <div class={s.turns}>
        {st.turns.map((t) =>
          t.role === 'you' ? (
            <div class={s.turnYou}>{t.text}</div>
          ) : (
            <div class={s.turnFabry}>
              <div>{t.text}</div>
              {t.applied != null && (
                <div class={s.dim}>
                  {t.applied
                    ? `Applied ${t.applied} change${t.applied === 1 ? '' : 's'} as one edit.`
                    : 'Nothing was applied.'}
                </div>
              )}
              {t.problems?.map((p) => (
                <div class={s.rowError}>{p}</div>
              ))}
              {t.reply && (
                <details>
                  <summary class={s.dim}>Mr. Fabry's reply</summary>
                  <pre class={s.code}>{t.reply}</pre>
                </details>
              )}
            </div>
          ),
        )}
      </div>
      {st.problems.length > 0 && !st.busy && (
        <button type="button" class={s.btn} data-action="fix-fabry" onClick={fixWithFabry}>
          Ask Mr. Fabry to fix {st.problems.length === 1 ? 'this' : `these ${st.problems.length}`}
        </button>
      )}
      <AskFabry
        state={{ chatId: st.chatId, busy: st.busy, error: st.error, reply: null, warnings: [] }}
        onAsk={(text) => askSchemaFabry(text)}
        placeholder="Describe the schema change, e.g. add a VAT section with rate and amount"
        followupPlaceholder="What else should change?"
        doneText=""
      />
    </aside>
  );
}
