import { h } from 'preact';
import {
  hookEditor,
  hookDirty,
  hookErrors,
  hookSaving,
  hookAssist,
  hookAssistRev,
  hooks,
  hookRefs,
} from '../store.js';
import {
  updateHookDraft,
  closeHookEditor,
  saveHook,
  discardHook,
  askHookAssistant,
} from '../index.jsx';
import CodeEditor from './CodeEditor.jsx';
import { hookEditorRef } from './hookJump.js';
import AskFabry from './AskFabry.jsx';
import s from './Builder.module.css';

// "Format" for JSON: parse and print with two-space indent. A parse error is the message.
const formatJson = async (src: string) => JSON.stringify(JSON.parse(src), null, 2);

// Hook mode's right panel: one MDH hook's settings as JSON, Mr. Fabry, and its own Save.
export default function HookEditor() {
  const ed = hookEditor.value!;
  const hook = hooks.value.find((h) => h.id === ed.hookId);
  const refs = hookRefs.value;
  return (
    <aside class={s.inspector + ' ' + s.inspectorFill} data-panel="hook">
      <div class={s.ruleHead}>
        <h4 class={s.inspTitle}>
          {hook?.name ?? 'Hook'} ({ed.hookId})
        </h4>
        <button
          type="button"
          class={s.iconBtn}
          data-action="close-hook"
          title="Close (Esc)"
          onClick={closeHookEditor}
        >
          ✕
        </button>
      </div>
      <div class={s.dim}>
        Matches on {refs?.inputs.size ?? 0} field(s), fills {refs?.outputs.size ?? 0}. The grid
        shows only those.
      </div>
      <AskFabry
        key={`fabry-hook:${ed.hookId}`}
        state={hookAssist.value}
        onAsk={askHookAssistant}
        placeholder="Describe how the matching should change"
        followupPlaceholder="What should change?"
        doneText="Proposal filled in — review, then Save hook or Discard."
      />
      <div class={s.field + ' ' + s.grow}>
        <span class={s.fieldLabel}>Settings (JSON)</span>
        <CodeEditor
          key={`hook:${ed.hookId}:${hookAssistRev.value}`}
          name="hook"
          handleRef={hookEditorRef}
          language="json"
          formatter={formatJson}
          expanded
          value={ed.draft}
          onCommit={updateHookDraft}
        />
      </div>
      {hookErrors.value.length > 0 && (
        <div class={s.rowError}>
          {hookErrors.value.map((m) => (
            <div>{m}</div>
          ))}
        </div>
      )}
      <div class={s.dialogActions}>
        <button type="button" class={s.btn} onClick={closeHookEditor}>
          Close
        </button>
        <button
          type="button"
          class={s.btn}
          data-action="discard-hook"
          disabled={!hookDirty.value}
          onClick={discardHook}
        >
          Discard
        </button>
        <button
          type="button"
          class={s.btn + ' ' + s.primary}
          data-action="save-hook"
          disabled={!hookDirty.value || hookSaving.value}
          onClick={saveHook}
        >
          {hookSaving.value ? 'Saving…' : 'Save hook'}
        </button>
      </div>
    </aside>
  );
}
