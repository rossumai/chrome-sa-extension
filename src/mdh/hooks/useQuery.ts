import { useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { trackOnce } from '../../usage/track.js';
import { records as recordsSignal, queryRun } from '../store.js';
import * as api from '../api.js';
import * as cache from '../cache.js';
import JSON5 from 'json5';

type QueryState = {
  queryId: number;
  lastQueryMs: ReturnType<typeof signal<number>>;
  cacheNextQuery: boolean;
  controller: AbortController | null;
};

export function useQuery() {
  const stateRef = useRef<QueryState | null>(null);
  if (!stateRef.current) {
    stateRef.current = {
      queryId: 0,
      lastQueryMs: signal(0),
      cacheNextQuery: false,
      controller: null,
    };
  }
  const state = stateRef.current!;

  async function runQuery(
    collection: string | null | undefined,
    rawText: string | null | undefined,
    substituteFn?: (text: string) => string,
    // Async work that must finish before the aggregate is sent (DataPanel
    // resolves placeholder field types, which decide how a value substitutes).
    // It runs inside this query's loading window, so a slow one shows as
    // loading rather than as an empty result, and a newer query supersedes it.
    prepare?: () => Promise<unknown>,
  ) {
    if (!collection || !rawText) return;
    // trackOnce, NOT track: DataPanel auto-invokes this on collection select,
    // sort, filter, pagination and every editor keystroke, so per-call counting
    // measured typing rather than use. Once per Console session is the honest
    // signal — "this person used the query surface".
    trackOnce('sa_mdh_query_run');

    // Unfilled variables substitute to an empty string, so there is nothing to
    // "wait for" — just run whatever resolves to a valid pipeline. (Invalid
    // JSON, e.g. a half-typed pipeline, is still skipped by the parse below.)
    const parse = (): api.PipelineStage[] | null => {
      try {
        const parsed = JSON5.parse(substituteFn ? substituteFn(rawText) : rawText);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };
    // Gate on validity BEFORE touching any state: a half-typed pipeline must
    // neither run nor cancel the query already in flight. Types only change how
    // a value is quoted, never whether the text parses.
    let pipeline = parse();
    if (!pipeline) return;

    // Capture and immediately consume the one-shot cache flag so it stays
    // bound to *this* call. Without this, a slow query A could supersede,
    // then query B would see A's flag and cache B's result for a different
    // collection.
    const shouldCache = state.cacheNextQuery;
    state.cacheNextQuery = false;

    // Abort any in-flight aggregate so a superseded request stops consuming
    // bandwidth and can never write its (stale) result into the cache slot.
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    const thisQueryId = ++state.queryId;
    const isCurrent = () => thisQueryId === state.queryId;
    const startedAt = Date.now();
    const afterMs = () => Date.now() - startedAt;
    // Abort the request and stand down. The old records belong to a different
    // query than the editor now shows, so they go too. Aborting only stops the
    // browser waiting; Data Storage may still finish the aggregate server-side.
    // A stale handle (a newer query is running) does nothing.
    const cancel = () => {
      if (!isCurrent()) return;
      state.queryId++;
      controller.abort();
      recordsSignal.value = [];
      queryRun.value = { phase: 'cancelled', afterMs: afterMs() };
    };
    queryRun.value = { phase: 'running', startedAt, cancel };

    try {
      if (prepare) {
        try {
          await prepare();
        } catch {
          /* best-effort: run with whatever types are known */
        }
        if (!isCurrent()) return;
        pipeline = parse();
        if (!pipeline) {
          queryRun.value = { phase: 'idle' };
          return;
        }
      }
      const start = performance.now();
      const res = await api.aggregate(collection, pipeline, { signal: controller.signal });
      if (!isCurrent()) return;
      const elapsed = Math.round(performance.now() - start);
      state.lastQueryMs.value = elapsed;
      const result = res.result || [];
      if (shouldCache) cache.set(collection, 'records', result);
      recordsSignal.value = result;
      queryRun.value = { phase: 'done', count: result.length, ms: elapsed };
      return { records: result, elapsed };
    } catch (err) {
      if (!isCurrent()) return;
      // A query's failure belongs next to the query (the results area), not in
      // the global banner; its records no longer match the editor either.
      recordsSignal.value = [];
      queryRun.value = {
        phase: 'failed',
        message: (err as any)?.message || String(err),
        timedOut: (err as any)?.timedOut === true,
        afterMs: afterMs(),
      };
    }
  }

  function setCacheNextQuery(val: boolean) {
    state.cacheNextQuery = val;
  }

  return {
    lastQueryMs: state.lastQueryMs,
    runQuery,
    setCacheNextQuery,
  };
}
