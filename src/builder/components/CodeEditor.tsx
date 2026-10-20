import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { formatPython, ruffFormat } from '../format.js';
import s from './Builder.module.css';

function prefersDark() {
  try {
    return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

const surface = EditorView.theme({
  '&': { fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace' },
});
// Collapsed, the editor stops growing at 320px and scrolls; expanded, it fills its panel.
const collapsed = EditorView.theme({ '.cm-scroller': { maxHeight: '320px' } });

// A Python editor for a formula. Commits on blur (one finished edit = one history entry) and
// after Format. The parent remounts it by key when the value changes from outside (undo).
export default function CodeEditor({
  value,
  onCommit,
  name,
  expanded = false,
  onToggleExpand,
  onFocusInsert,
}: {
  value: string;
  onCommit: (v: string) => void;
  name: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Called on focus with a function that inserts text at the cursor (and commits it). */
  onFocusInsert?: (insert: (text: string) => void) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!host.current) return undefined;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        selection: { anchor: value.length }, // start at the end, where a click-insert continues
        extensions: [
          basicSetup,
          python(),
          surface,
          ...(expanded ? [] : [collapsed]),
          ...(prefersDark() ? [oneDark] : []),
          EditorView.domEventHandlers({
            focus: (_e, ed) => {
              onFocusInsert?.((text) => {
                // Right after a word or a closing bracket, a space keeps the two apart.
                const at = ed.state.selection.main.from;
                const before = ed.state.sliceDoc(Math.max(0, at - 1), at);
                ed.dispatch(ed.state.replaceSelection(/[\w)\]]/.test(before) ? ` ${text}` : text));
                ed.focus();
                onCommit(ed.state.doc.toString());
              });
            },
            blur: (_e, ed) => {
              const text = ed.state.doc.toString();
              if (text !== value) onCommit(text);
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  const format = async () => {
    const v = view.current;
    if (!v) return;
    setBusy(true);
    const r = await formatPython(v.state.doc.toString(), ruffFormat);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.text !== value) onCommit(r.text);
  };

  return (
    <div data-code={name} class={expanded ? s.codeFill : undefined}>
      <div ref={host} class={expanded ? s.codeHost : undefined} />
      <div class={s.codeBar}>
        <button
          type="button"
          class={s.linkBtn}
          data-action={`format-${name}`}
          disabled={busy}
          onClick={format}
          title="Format with Ruff (loads the formatter on first use)"
        >
          {busy ? 'Formatting…' : 'Format'}
        </button>
        {onToggleExpand && (
          <button
            type="button"
            class={s.linkBtn}
            data-action={`expand-${name}`}
            onClick={onToggleExpand}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        {error && <span class={s.rowError}>{error}</span>}
      </div>
    </div>
  );
}
