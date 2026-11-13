// The popup's views off Rossum, NetSuite and Coupa — an unrelated tab, or the Console —
// decided here, DOM-free; components/OffSite.tsx and components/ConsoleView.tsx render it.
import { annotationIdFromPath } from '../rossum/annotationUrl.js';

/** The unlock / hide notice (5 clicks on the version hash), shown for 2.5 s. `fellBack`:
 *  hiding moved the Console off a gated app, back to Dataset Management. */
export type UnlockNotice = { unlocked: boolean; fellBack: boolean };

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// Where a Rossum tab is, from its URL alone — no API call, so a queue is named by its id.
export function tabPlace(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const annotation = annotationIdFromPath(path);
  if (annotation) return `Document ${annotation}`;
  const queue = /^\/queues\/(\d+)(?:[/?#]|$)/.exec(path);
  if (queue) return `Queue ${queue[1]}`;
  if (/^\/settings(?:[/?#]|$)/.test(path)) return 'Settings';
  return null;
}

// The organizations the user recently visited, from the recently viewed annotations
// (newest first already): each origin once, at its newest visit.
export function recentOrigins(viewed: unknown): { origin: string; at: number }[] {
  if (!Array.isArray(viewed)) return [];
  const out: { origin: string; at: number }[] = [];
  for (const e of viewed) {
    if (typeof e?.origin !== 'string' || typeof e.at !== 'number') continue;
    if (!out.some((o) => o.origin === e.origin)) out.push({ origin: e.origin, at: e.at });
  }
  return out;
}

export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60e3);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'yesterday';
  return `${Math.floor(hours / 24)} d ago`;
}

type KeyLike = {
  key: string;
  target?: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

// The row a key picks in a numbered list: Enter the first, 1-9 their row. Never while
// typing into a field, and never with a modifier (those are the browser's shortcuts).
export function rowForKey(e: KeyLike, count: number): number | null {
  if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return null;
  // Enter on a focused button or link is that control's (a row's Console button, the
  // Support link); only Enter with nothing focused picks the first row.
  if (e.key === 'Enter') return count > 0 && !isControl(e.target) ? 0 : null;
  if (!/^[1-9]$/.test(e.key)) return null;
  const row = Number(e.key) - 1;
  return row < count ? row : null;
}

function isControl(target: EventTarget | null | undefined): boolean {
  const el = target as Element | null | undefined;
  return !!el && typeof el.tagName === 'string' && /^(BUTTON|A|SUMMARY)$/.test(el.tagName);
}

function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as Element | null | undefined;
  if (!el || typeof el.tagName !== 'string') return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const editable = el.getAttribute?.('contenteditable');
  return editable === '' || editable === 'true';
}
