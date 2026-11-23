// Pure core of the Data panel's query loading states (spec:
// docs/superpowers/specs/2026-11-23-mdh-loading-states-design.md §3). DOM-free:
// useQuery publishes a QueryRun, and the results area, the status chip and the
// notices all derive what to show from it here, so they can never disagree.

export type QueryRun =
  | { phase: 'idle' }
  | { phase: 'running'; startedAt: number; cancel: () => void }
  | { phase: 'done'; count: number; ms: number }
  | { phase: 'cancelled'; afterMs: number }
  | { phase: 'failed'; message: string; timedOut: boolean; afterMs: number };

// A query that answers within this never shows as loading, so typing (which
// auto-runs the pipeline) does not flash anything.
export const SHOW_AFTER_MS = 300;
// From here on the run is "slow": amber chip and an explanation.
export const SLOW_AFTER_MS = 10_000;
// "Run on a sample" prepends a $sample of this size.
export const SAMPLE_SIZE = 10000;

export type QueryMode =
  'pending' | 'records' | 'skeleton' | 'stale' | 'cancelled' | 'failed' | 'empty';

export function queryView(
  run: QueryRun,
  now: number,
  hasRecords: boolean,
): { mode: QueryMode; slow: boolean; elapsedS: number } {
  if (run.phase === 'running') {
    const elapsed = Math.max(0, now - run.startedAt);
    const shown = elapsed >= SHOW_AFTER_MS;
    const mode = hasRecords ? (shown ? 'stale' : 'records') : shown ? 'skeleton' : 'pending';
    return { mode, slow: elapsed >= SLOW_AFTER_MS, elapsedS: Math.floor(elapsed / 1000) };
  }
  if (run.phase === 'cancelled') return { mode: 'cancelled', slow: false, elapsedS: secs(run) };
  if (run.phase === 'failed') return { mode: 'failed', slow: false, elapsedS: secs(run) };
  return { mode: hasRecords ? 'records' : 'empty', slow: false, elapsedS: 0 };
}

function secs(run: { afterMs: number }): number {
  return Math.floor(run.afterMs / 1000);
}

export type Chip = { tone: 'idle' | 'run' | 'slow' | 'failed'; text: string; cancellable: boolean };

export function chipFor(run: QueryRun, now: number): Chip | null {
  switch (run.phase) {
    case 'idle':
      return null;
    case 'running': {
      const elapsed = Math.max(0, now - run.startedAt);
      if (elapsed < SHOW_AFTER_MS) return null;
      const s = Math.floor(elapsed / 1000);
      return elapsed >= SLOW_AFTER_MS
        ? { tone: 'slow', text: `Slow · ${s} s`, cancellable: true }
        : { tone: 'run', text: s < 1 ? 'Running…' : `Running · ${s} s`, cancellable: true };
    }
    case 'done':
      return {
        tone: 'idle',
        text: `${run.count} doc${run.count === 1 ? '' : 's'} · ${run.ms} ms`,
        cancellable: false,
      };
    case 'cancelled':
      return { tone: 'idle', text: `Cancelled after ${secs(run)} s`, cancellable: false };
    case 'failed':
      return {
        tone: 'failed',
        text: run.timedOut ? 'Timed out · 30 s' : 'Query failed',
        cancellable: false,
      };
  }
}

// An index helps a $match on `field` when its FIRST key is that field, or it is
// a wildcard over it (`$**`, or `prefix.$**` with field under prefix).
function covers(index: any, field: string): boolean {
  const keys = Object.keys(index?.key || {});
  if (keys.length === 0) return false;
  if (keys.includes('$**')) return true;
  for (const k of keys) {
    if (k.endsWith('.$**') && field.startsWith(k.slice(0, -3))) return true;
  }
  return keys[0] === field;
}

// The likely reason a query is slow, claimed only with evidence: the FIRST stage
// is a $match and none of its top-level fields is covered by an index, so it
// reads every record. Null when the indexes are unknown (not cached), the
// pipeline does not start with $match, or any matched field is covered.
export function slowCause(stages: any[], indexes: any[] | null): { field: string } | null {
  if (!Array.isArray(indexes)) return null;
  const first = Array.isArray(stages) ? stages[0] : null;
  const match = first && typeof first === 'object' ? first.$match : null;
  if (!match || typeof match !== 'object') return null;
  const fields = Object.keys(match).filter((k) => !k.startsWith('$'));
  if (fields.length === 0) return null;
  if (fields.some((f) => indexes.some((ix) => covers(ix, f)))) return null;
  return { field: fields[0] };
}

// "Run on a sample": put a $sample first. In place, because it is a mutator for
// applyMutationToText (DataPanel's mutatePipelineText), which keeps the user's
// comments and formatting around the stages it did not touch.
export function prependSample(stages: any[]): void {
  const first = stages[0];
  if (first && typeof first === 'object' && '$sample' in first) return;
  stages.unshift({ $sample: { size: SAMPLE_SIZE } });
}
