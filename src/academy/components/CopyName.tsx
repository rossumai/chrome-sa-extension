import { h, Fragment } from 'preact';
import { useCopy } from './useCopy.js';
import css from '../Academy.module.css';

/**
 * A name the trainee must use EXACTLY, with its own copy button. Every place the copy
 * names one of the run's objects renders it this way (owner, 2026-11-16): the Academy
 * finds work only by these names, so retyping one is how a task silently never ticks.
 * `inline` sits inside a sentence; the default is the names box's larger chip.
 *
 * The button is an icon (owner, 2026-11-16): a copy glyph that turns into a check once
 * the clipboard took it, or a warning if the browser refused. The words live in the
 * accessible name and the tooltip.
 */
export default function CopyName({ value, inline }: { value: string; inline?: boolean }) {
  const [state, copy] = useCopy();
  const label =
    state === 'copied' ? `Copied ${value}` : state === 'failed' ? 'Copy failed' : `Copy ${value}`;
  return (
    <span class={`${css.chip}${inline ? ` ${css.chipInline}` : ''}`} data-copy={state}>
      <code>{value}</code>
      <button
        type="button"
        class={css.chipCopy}
        aria-label={label}
        title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        onClick={() => copy(value)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width={state === 'idle' ? 2.25 : 3}
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          {state === 'copied' ? (
            <polyline points="20 6 9 17 4 12" />
          ) : state === 'failed' ? (
            <path d="M12 7v6M12 17h.01" />
          ) : (
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
      </button>
      <span class={css.srOnly} aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </span>
  );
}
