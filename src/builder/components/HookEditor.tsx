import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  hookEditor,
  hookDirty,
  hookErrors,
  hookSaving,
  hookAssist,
  hookAssistRev,
  hooks,
  hookRefs,
  hookConfigIndex,
  hookLive,
} from '../store.js';
import {
  updateHookDraft,
  closeHookEditor,
  saveHook,
  discardHook,
  askHookAssistant,
} from '../index.jsx';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor.jsx';
import { configRange } from '../jsonRanges.js';
import { configSummaries } from '../matching.js';
import AskFabry from './AskFabry.jsx';
import { rightPanel } from './panels.js';
import s from './Builder.module.css';

// "Format" for JSON: parse and print with two-space indent. A parse error is the message.
const formatJson = async (src: string) => JSON.stringify(JSON.parse(src), null, 2);

// Hook mode's right panel: one MDH hook's settings as JSON, Mr. Fabry, and its own Save.
export default function HookEditor() {
  useEffect(rightPanel.load, []);
  const ed = hookEditor.value!;
  const hook = hooks.value.find((h) => h.id === ed.hookId);
  const refs = hookRefs.value;
  const configs = hookLive.value ? configSummaries(hookLive.value) : [];
  const editor = useRef<CodeEditorHandle | null>(null);
  // Pick a configuration: narrow the grid to it, and jump the editor to its "{" with a flash.
  const pick = (i: number) => {
    hookConfigIndex.value = i;
    const h = editor.current;
    const r = h && configRange(h.getText(), i);
    if (h && r) h.reveal(r.from, r.to);
  };
  return (
    <aside
      class={s.inspector + ' ' + s.inspectorFill}
      style={{ width: `${rightPanel.width.value}px` }}
      data-panel="hook"
    >
      <div
        class={s.inspectorResizer}
        data-resize="inspector"
        onMouseDown={(e) => rightPanel.start(e as MouseEvent, -1)}
      />
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
      <div class={s.configList}>
        <button
          type="button"
          data-config-index="all"
          class={s.configItem + (hookConfigIndex.value == null ? ' ' + s.queueOn : '')}
          onClick={() => (hookConfigIndex.value = null)}
        >
          All configurations ({configs.length})
        </button>
        {configs.map((c) => (
          <button
            type="button"
            data-config-index={String(c.index)}
            class={s.configItem + (hookConfigIndex.value === c.index ? ' ' + s.queueOn : '')}
            title={`Show only the fields configuration ${c.index + 1} uses`}
            onClick={() => pick(c.index)}
          >
            <b>{c.index + 1}</b> · {c.name}
            <span class={s.dim}>
              {c.dataset ? ` · ${c.dataset}` : ''}
              {c.target ? ` → ${c.target}` : ''}
            </span>
          </button>
        ))}
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
          handleRef={editor}
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
