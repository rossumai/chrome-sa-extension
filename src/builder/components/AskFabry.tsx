import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { AssistState } from '../store.js';
import FabryMark from '../../ui/FabryMark.jsx';
import s from './Builder.module.css';

// "Ask Mr. Fabry": a plain-language request box, shared by the rule editor and the field
// inspector. The caller does the asking and holds the state; this only draws it.
export default function AskFabry({
  state,
  onAsk,
  initial = '',
  placeholder,
  followupPlaceholder,
  doneText,
}: {
  state: AssistState;
  onAsk: (text: string) => void;
  initial?: string;
  placeholder: string;
  followupPlaceholder: string;
  doneText: string;
}) {
  const [text, setText] = useState(initial);
  const ask = () => onAsk(text);
  return (
    <div class={s.fabryBox}>
      <div class={s.fabryHead}>
        <FabryMark size={16} animated={state.busy} />
        <span class={s.fieldLabel}>Ask Mr. Fabry</span>
      </div>
      <textarea
        class={s.input}
        data-fabry-prompt=""
        rows={3}
        placeholder={state.chatId ? followupPlaceholder : placeholder}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
        }}
      />
      <div class={s.codeBar}>
        <button
          type="button"
          class={s.btn}
          data-action="ask-fabry"
          disabled={state.busy || !text.trim()}
          onClick={ask}
          title="Ask (⌘Enter)"
        >
          {state.busy ? 'Mr. Fabry is writing…' : state.chatId ? 'Ask again' : 'Ask'}
        </button>
        {!state.busy && state.chatId && !state.error && <span class={s.dim}>{doneText}</span>}
      </div>
      {state.error && <div class={s.rowError}>{state.error}</div>}
      {state.warnings.map((w) => (
        <div class={s.warn}>{w}</div>
      ))}
      {state.reply && (
        <details>
          <summary class={s.dim}>Mr. Fabry's reply</summary>
          <pre class={s.code}>{state.reply}</pre>
        </details>
      )}
    </div>
  );
}
