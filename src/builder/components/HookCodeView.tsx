import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { rightPanel, hooks, type RightPanel } from '../store.js';
import { closeCodeView } from '../index.jsx';
import { hookText, codeHidden, occurrences } from '../codeRefs.js';
import CodeEditor, { type CodeEditorHandle } from './CodeEditor.jsx';
import WideButton from './WideButton.jsx';
import s from './Builder.module.css';

// A hook that mentions a field, read-only: its code or its settings, scrolled to each place
// the field id appears (↑/↓ step through them). Editing other hooks is out of scope.
export default function HookCodeView() {
  const cv = rightPanel.value as Extract<RightPanel, { kind: 'code' }>;
  const hook = hooks.value.find((x) => x.id === cv.hookId);
  const text = hookText(hook);
  const inCode = occurrences(text.code, cv.fieldId);
  const inSettings = occurrences(text.settings, cv.fieldId);
  const [tab, setTab] = useState<'code' | 'settings'>(inCode.length ? 'code' : 'settings');
  const [at, setAt] = useState(0);
  const handle = useRef<CodeEditorHandle | null>(null);
  const hits = tab === 'code' ? inCode : inSettings;
  const i = Math.min(at, Math.max(hits.length - 1, 0));
  // After the editor (a child, so mounted first) exists: jump to the current match.
  useEffect(() => {
    if (hits[i]) handle.current?.reveal(hits[i].from, hits[i].to);
  }, [tab, i]);
  if (!hook) return null;
  const pick = (t: 'code' | 'settings') => {
    setTab(t);
    setAt(0);
  };
  return (
    <aside class={s.inspector + ' ' + s.inspectorFill} data-panel="code">
      <div class={s.ruleHead}>
        <h4 class={s.inspTitle}>
          {hook.name} ({hook.id})
        </h4>
        <WideButton />
        <button
          type="button"
          class="icon-btn"
          data-action="close-code"
          title="Close (Esc)"
          onClick={closeCodeView}
        >
          ✕
        </button>
      </div>
      <div class={s.dim}>
        {hook.type ?? 'hook'} · read-only · mentions <span class={s.mono}>{cv.fieldId}</span>{' '}
        {inCode.length + inSettings.length}×
      </div>
      {codeHidden(hook) && (
        <div class={s.dim}>A webhook runs on its own server: only its settings are searched.</div>
      )}
      <div class={'tab-bar ' + s.tabs}>
        {text.code && (
          <button
            type="button"
            data-tab="code"
            class={'tab' + (tab === 'code' ? ' active' : '')}
            onClick={() => pick('code')}
          >
            Code ({inCode.length})
          </button>
        )}
        {text.settings && (
          <button
            type="button"
            data-tab="settings"
            class={'tab' + (tab === 'settings' ? ' active' : '')}
            onClick={() => pick('settings')}
          >
            Settings ({inSettings.length})
          </button>
        )}
        <span class={s.spacer} />
        {hits.length > 0 && (
          <span class={s.dim} data-match="">
            {i + 1} of {hits.length}{' '}
            <button
              type="button"
              class="icon-btn"
              data-action="prev-match"
              title="Previous"
              onClick={() => setAt((i - 1 + hits.length) % hits.length)}
            >
              ↑
            </button>
            <button
              type="button"
              class="icon-btn"
              data-action="next-match"
              title="Next"
              onClick={() => setAt((i + 1) % hits.length)}
            >
              ↓
            </button>
          </span>
        )}
      </div>
      <div class={s.field + ' ' + s.grow}>
        <CodeEditor
          key={`${hook.id}:${tab}`}
          name="hook-view"
          value={tab === 'code' ? text.code : text.settings}
          language={tab === 'code' ? 'python' : 'json'}
          expanded
          readOnly
          handleRef={handle}
        />
      </div>
    </aside>
  );
}
