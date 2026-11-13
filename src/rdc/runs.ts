// The rdc runs this page has started and not seen settle. rdc's Web Lock is held for a whole run,
// and a run the page has left (an abandoned read) still holds it until it ends, so a lock refusal
// while one of ours is pending is this tab's own, not another tab's.
import { runErrorFor } from './core.js';

let pending = 0;

export function tracked<T>(run: Promise<T>): Promise<T> {
  pending++;
  return run.finally(() => {
    pending--;
  });
}

const OWN_LOCK =
  'This tab is still finishing an earlier run on this org, which holds its lock. Wait a moment, then retry.';

// `runErrorFor`, told whether the page still has a run in flight. Ask at the moment the error
// arrives: the earlier run may end a moment later.
export function explainRunError(message: string): string | null {
  if (pending > 0 && message.includes('already being synced in another tab')) return OWN_LOCK;
  return runErrorFor(message);
}
