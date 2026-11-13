// A prompt rdc raises during a run, shown with its choices. Leaving the page, or Cancel, answers
// `null`, which rdc reads as "no answer", so a run never hangs on a prompt nobody can see.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { answerFor } from '../core.js';
import type { Prompt } from '../wasm.js';
import { LogLine } from './Log.jsx';
import styles from './Deploy.module.css';

type Pending = { prompt: Prompt; answer: (key: string | null) => void };

// `ask` is rdc's onPrompt; `lastLine` is shown above the question, which for most kinds is only
// rdc's menu of keys.
export function usePrompts(): {
  ask: (p: Prompt) => Promise<string | null>;
  pending: Pending | null;
} {
  const alive = useRef(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  useEffect(
    () => () => {
      alive.current = false;
      ref.current?.answer(null);
    },
    [],
  );
  const ask = (prompt: Prompt) =>
    new Promise<string | null>((resolve) => {
      if (!alive.current) return resolve(null);
      const p: Pending = {
        prompt,
        answer: (key) => {
          if (ref.current === p) ref.current = null;
          if (alive.current) setPending(null);
          resolve(answerFor(prompt, key));
        },
      };
      ref.current = p;
      setPending(p);
    });
  return { ask, pending };
}

// `about`: the org the run asks about, when two runs can ask at once.
export function AskPanel({
  pending,
  lastLine,
  about,
}: {
  pending: Pending;
  lastLine: string;
  about?: string;
}) {
  const title =
    pending.prompt.kind === 'recoverCreate' ? 'A deployment stopped in the middle' : 'rdc asks';
  return (
    <div class={`${styles.panel} ${styles.ask}`} role="dialog" aria-label={title}>
      <div class={styles.panelB}>
        {pending.prompt.kind === 'recoverCreate' && <h2>{title}</h2>}
        {about && <div class={styles.gh}>About {about}</div>}
        {lastLine && pending.prompt.kind !== 'recoverCreate' && (
          <div class={styles.term}>
            <LogLine line={lastLine} />
          </div>
        )}
        <div class={styles.question}>{pending.prompt.question}</div>
        <div class={styles.choices}>
          {pending.prompt.choices.map((c) => (
            <button class="btn btn-secondary" onClick={() => pending.answer(c.key)}>
              {c.label}
            </button>
          ))}
          <button class="btn btn-secondary" onClick={() => pending.answer(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
