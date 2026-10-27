import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { formatPython, ruffFormat, type PythonFormatter } from '../format.js';
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
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
});
// A short highlight over a range ("this is the part you picked"), cleared by a timer.
const flashOn = StateEffect.define<{ from: number; to: number }>();
const flashOff = StateEffect.define<null>();
const flashMark = Decoration.mark({ class: 'cm-flash' });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashOn)) deco = Decoration.set([flashMark.range(e.value.from, e.value.to)]);
      else if (e.is(flashOff)) deco = Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
// The flash fades from the highlight color to nothing over FLASH_MS; the timer then drops
// the (by then invisible) decoration. Keyframe names are global, hence the prefix.
const flashTheme = EditorView.theme({
  '.cm-flash': {
    borderRadius: '2px',
    animation: 'builder-cm-flash 1.2s ease-out forwards',
  },
  '@keyframes builder-cm-flash': {
    from: { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
    to: { backgroundColor: 'transparent' },
  },
});
const FLASH_MS = 1200;

/** What a parent may do to the editor: read its text, or jump to a range and flash it. */
export type CodeEditorHandle = {
  getText: () => string;
  reveal: (from: number, to: number) => void;
};

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
  language = 'python',
  formatter = ruffFormat,
  handleRef,
  readOnly = false,
}: {
  value: string;
  /** Not for a read-only view. */
  onCommit?: (v: string) => void;
  name: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  language?: 'python' | 'json';
  /** What Format runs; Ruff for Python. A syntax error comes back as a message. */
  formatter?: PythonFormatter;
  handleRef?: { current: CodeEditorHandle | null };
  /** A view, not an editor: no typing, no Format (the hook view). */
  readOnly?: boolean;
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
        selection: { anchor: value.length }, // start at the end of the text
        extensions: [
          basicSetup,
          language === 'json' ? json() : python(),
          surface,
          flashField,
          flashTheme,
          ...(expanded ? [] : [collapsed]),
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
          ...(prefersDark() ? [oneDark] : []),
          EditorView.domEventHandlers({
            blur: (_e, ed) => {
              const text = ed.state.doc.toString();
              if (text !== value) onCommit?.(text);
            },
          }),
        ],
      }),
    });
    view.current = v;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (handleRef) {
      handleRef.current = {
        getText: () => v.state.doc.toString(),
        reveal: (from, to) => {
          v.dispatch({
            selection: { anchor: from },
            effects: [EditorView.scrollIntoView(from, { y: 'start' }), flashOn.of({ from, to })],
          });
          clearTimeout(timer);
          timer = setTimeout(() => v.dispatch({ effects: flashOff.of(null) }), FLASH_MS);
        },
      };
    }
    return () => {
      clearTimeout(timer);
      if (handleRef) handleRef.current = null;
      v.destroy();
      view.current = null;
    };
  }, []);

  const format = async () => {
    const v = view.current;
    if (!v) return;
    setBusy(true);
    const r = await formatPython(v.state.doc.toString(), formatter);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.text !== value) onCommit?.(r.text);
  };

  return (
    <div data-code={name} class={expanded ? s.codeFill : undefined}>
      <div ref={host} class={expanded ? s.codeHost : undefined} />
      <div class={s.codeBar}>
        {!readOnly && (
          <button
            type="button"
            class="btn-link"
            data-action={`format-${name}`}
            disabled={busy}
            onClick={format}
            title={
              language === 'json'
                ? 'Format the JSON'
                : 'Format with Ruff (loads the formatter on first use)'
            }
          >
            {busy ? 'Formatting…' : 'Format'}
          </button>
        )}
        {onToggleExpand && (
          <button
            type="button"
            class="btn-link"
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
